// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.0;
pragma abicoder v2;

import {ReentrancyGuard} from '@openzeppelin/contracts/security/ReentrancyGuard.sol';
import {SafeMath} from '@openzeppelin/contracts/utils/math/SafeMath.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {SafeCast} from '@openzeppelin/contracts/utils/math/SafeCast.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/draft-IERC20Permit.sol";
import {PermissionAdmin} from './PermissionAdmin.sol';
import {IMultiRewardStaking} from './interfaces/IMultiRewardStaking.sol';

interface ArbSys {
    /**
    * @notice Get Arbitrum block number (distinct from L1 block number; Arbitrum genesis block has block number 0)
    * @return block number as int
     */ 
    function arbBlockNumber() external view returns (uint);
} 

/// Allow stakers to stake token and receive reward tokens
/// Allow extend or renew a pool to continue/restart the staking program
/// When harvesting, rewards will be transferred to a user account
/// Support multiple reward tokens, reward tokens must be distinct and immutable
contract MultiRewardStaking is IMultiRewardStaking, PermissionAdmin, ReentrancyGuard {
  using SafeMath for uint256;
  using SafeCast for uint256;
  using SafeERC20 for IERC20;

  uint256 internal constant PRECISION = 1e12;

  struct UserRewardData {
    uint256 unclaimedReward;
    uint256 lastRewardPerShare;
  }
  // Info of each user.
  struct UserInfo {
    uint256 amount; // How many Staking tokens the user has provided.
    mapping (uint256 => UserRewardData) userRewardData;
    //
    // Basically, any point in time, the amount of reward token
    // entitled to a user but is pending to be distributed is:
    //
    //   pending reward = user.unclaimAmount + (user.amount * (pool.accRewardPerShare - user.lastRewardPerShare)
    //
    // Whenever a user deposits or withdraws Staking tokens to a pool. Here's what happens:
    //   1. The pool's `accRewardPerShare` (and `lastRewardBlock`) gets updated.
    //   2. User receives the pending reward sent to his/her address.
    //   3. User's `lastRewardPerShare` gets updated.
    //   4. User's `amount` gets updated.
  }

  struct PoolRewardData {
    uint256 rewardPerBlock;
    uint256 accRewardPerShare;
  }
  // Info of each pool
  // poolRewardData: reward data for each reward token
  //      rewardPerBlock: amount of reward token per block
  //      accRewardPerShare: accumulated reward per share of token
  // totalStake: total amount of stakeToken has been staked
  // stakeToken: token to stake, should be an ERC20 token
  // startBlock: the block that the reward starts
  // endBlock: the block that the reward ends
  // lastRewardBlock: last block number that rewards distribution occurs
  // maxStakeLimit: maximum number of staking tokens that can be staked, 0 means unlimited
  struct PoolInfo {
    uint256 totalStake;
    address stakeToken;
    uint32 startBlock;
    uint32 endBlock;
    uint32 lastRewardBlock;
    uint256 maxStakeLimit;
    mapping (uint256 => PoolRewardData) poolRewardData;
  }

  // check if a pool exists for a stakeToken
  mapping(address => bool) public poolExists;

  // list reward tokens, use 0x0 for native token (ETH), shouldn't be too many reward tokens
  // don't validate values or length by trusting the deployer
  address[] public rewardTokens;

  // Info of each pool.
  uint256 public override poolLength;
  mapping(uint256 => PoolInfo) internal poolInfo;
  // Info of each user that stakes Staking tokens.
  mapping(uint256 => mapping(address => UserInfo)) internal userInfo;

  bool public allowEmergencyExits;

  event AddNewPool(
    address indexed stakeToken,
    uint32 indexed startBlock,
    uint32 indexed endBlock,
    uint256[] rewardPerBlocks
  );
  event RenewPool(
    uint256 indexed pid,
    uint32 indexed startBlock,
    uint32 indexed endBlock,
    uint256[] rewardPerBlocks
  );
  event UpdatePool(
    uint256 indexed pid,
    uint32 indexed startBlock,
    uint32 indexed endBlock,
    uint256[] rewardPerBlocks
  );
  event Deposit(
    address indexed user,
    uint256 indexed pid,
    uint256 indexed blockNumber,
    uint256 amount
  );
  event Withdraw(
    address indexed user,
    uint256 indexed pid,
    uint256 indexed blockNumber,
    uint256 amount
  );
  event Harvest(
    address indexed user,
    uint256 indexed pid,
    address indexed rewardToken,
    uint256 lockedAmount,
    uint256 blockNumber
  );
  event EmergencyWithdraw(
    address indexed user,
    uint256 indexed pid,
    uint256 indexed blockNumber,
    uint256 amount
  );

  constructor(
    address _admin,
    address[] memory _rewardTokens
  ) PermissionAdmin(_admin) {
    rewardTokens = _rewardTokens;
  }

  receive() external payable {}

  /**
   * @dev Allow admin to withdraw only reward tokens
   */
  function adminWithdraw(uint256 rewardTokenIndex, uint256 amount) external onlyAdmin {
    IERC20 rewardToken = IERC20(rewardTokens[rewardTokenIndex]);
    if (rewardToken == IERC20(address(0))) {
      (bool success, ) = msg.sender.call{ value: amount }('');
      require(success, 'transfer reward token failed');
    } else {
      rewardToken.safeTransfer(msg.sender, amount);
    }
  }

  /**
   * @dev Add a new lp to the pool. Can only be called by the admin.
   * @param _stakeToken: token to be staked to the pool
   * @param _startBlock: block where the reward starts
   * @param _endBlock: block where the reward ends
   * @param _maxStakeLimit: maximum number of staking tokens that can be staked, 0 means unlimited
   * @param _rewardPerBlocks: amount of reward token per block for the pool for each reward token
   */
  function addPool(
    address _stakeToken,
    uint32 _startBlock,
    uint32 _endBlock,
    uint256 _maxStakeLimit,
    uint256[] calldata _rewardPerBlocks
  ) external override onlyAdmin {
    require(!poolExists[_stakeToken], 'add: duplicated pool');
    require(_stakeToken != address(0), 'add: invalid stake token');
    require(rewardTokens.length == _rewardPerBlocks.length, 'add: invalid length');

    uint256 _currBlock = getBlockNumber();
    require(_startBlock > _currBlock && _endBlock > _startBlock, 'add: invalid blocks');

    poolInfo[poolLength].stakeToken = _stakeToken;
    poolInfo[poolLength].startBlock = _startBlock;
    poolInfo[poolLength].endBlock = _endBlock;
    poolInfo[poolLength].lastRewardBlock = _startBlock;
    poolInfo[poolLength].maxStakeLimit = _maxStakeLimit;

    for(uint256 i = 0; i < _rewardPerBlocks.length; i++) {
      poolInfo[poolLength].poolRewardData[i] = PoolRewardData({
        rewardPerBlock: _rewardPerBlocks[i],
        accRewardPerShare: 0
      });
    }

    poolLength++;

    poolExists[_stakeToken] = true;

    emit AddNewPool(_stakeToken, _startBlock, _endBlock, _rewardPerBlocks);
  }

  /**
   * @dev Update a pool, allow to change end block, reward per block
   * @param _pid: pool id to be renew
   * @param _startBlock: block where the rewards will start
   * @param _endBlock: block where the reward ends
   * @param _rewardPerBlocks: amount of reward token per block for the pool,
   *   0 if we want to stop the pool from accumulating rewards
   */
  function updatePool(
    uint256 _pid,
    uint32 _startBlock,
    uint32 _endBlock,
    uint256[] calldata _rewardPerBlocks
  ) external override onlyAdmin {
    updatePoolRewards(_pid);

    PoolInfo storage pool = poolInfo[_pid];
    uint256 _currBlock = getBlockNumber();

    // require(pool.startBlock > _currBlock, 'update: pool already started');

    require(pool.endBlock > _currBlock, 'update: pool already ended');
    require(rewardTokens.length == _rewardPerBlocks.length, 'update: invalid length');
    require(_endBlock > _currBlock && _endBlock > pool.startBlock, 'update: invalid end block');

    pool.startBlock = _startBlock;
    pool.endBlock = _endBlock;
    pool.lastRewardBlock = _startBlock;

    for(uint256 i = 0; i < _rewardPerBlocks.length; i++) {
      pool.poolRewardData[i].rewardPerBlock = _rewardPerBlocks[i];
    }

    emit UpdatePool(_pid, _startBlock, _endBlock, _rewardPerBlocks);
  }

  /**
   * @dev Deposit tokens to accumulate rewards
   * @param _pid: id of the pool
   * @param _amount: amount of stakeToken to be deposited
   */
  function deposit(
    uint256 _pid,
    uint256 _amount
  ) external override nonReentrant {
    _deposit(msg.sender, _pid, _amount);
  }

  function depositWithPermit(
    uint256 _pid,
    uint256 _amount,
    uint256 _deadline,
    uint8 _v,
    bytes32 _r, 
    bytes32 _s
  ) external override nonReentrant {
      PoolInfo storage pool = poolInfo[_pid];
      
      // get approval using permit
      IERC20Permit(pool.stakeToken).permit(msg.sender, address(this), _amount, _deadline, _v, _r, _s);

      // check if contract have proper allowance or not
      require(IERC20(pool.stakeToken).allowance(msg.sender, address(this)) == _amount, 'A');

      // deposit staking token
      _deposit(msg.sender, _pid, _amount);
  }

  function _deposit(address _user, uint256 _pid, uint256 _amount) internal {
    
    PoolInfo storage pool = poolInfo[_pid];
    uint256 _currBlock = getBlockNumber();

    // check if maximum staking limit is reached or not
    if(pool.maxStakeLimit != 0){
      require(pool.maxStakeLimit >= pool.totalStake.add(_amount), 'deposit: maximum stake limit reached');
    }

    // collect stakeToken
    IERC20(pool.stakeToken).safeTransferFrom(_user, address(this), _amount);

    // update pool rewards, user's rewards
    updatePoolRewards(_pid);
    _updateUserReward(_user, _pid, false);

    UserInfo storage user = userInfo[_pid][_user];

    // update user staked amount, and total staked amount for the pool
    user.amount = user.amount.add(_amount);
    pool.totalStake = pool.totalStake.add(_amount);

    emit Deposit(_user, _pid, _currBlock, _amount);
  }
  /**
   * @dev Withdraw token (of the sender) from pool, also harvest rewards
   * @param _pid: id of the pool
   * @param _amount: amount of stakeToken to withdraw
   */
  function withdraw(uint256 _pid, uint256 _amount) external override nonReentrant {
    _withdraw(_pid, _amount);
  }

  /**
   * @dev Withdraw all tokens (of the sender) from pool, also harvest reward
   * @param _pid: id of the pool
   */
  function withdrawAll(uint256 _pid) external override nonReentrant {
    _withdraw(_pid, userInfo[_pid][msg.sender].amount);
  }

  function changeEmergencyExits(bool _exit) external onlyAdmin {
    allowEmergencyExits = _exit;
  }

  /**
   * @notice EMERGENCY USAGE ONLY, USER'S REWARDS WILL BE RESET
   * @dev Emergency withdrawal function to allow withdraw all deposited tokens (of the sender)
   *   and reset all rewards
   * @param _pid: id of the pool
   */
  function emergencyWithdraw(uint256 _pid) external override nonReentrant {
    require(allowEmergencyExits, 'emergencyWithdraw: not allowed at the moment');
    PoolInfo storage pool = poolInfo[_pid];
    UserInfo storage user = userInfo[_pid][msg.sender];
    uint256 amount = user.amount;

    user.amount = 0;
    for(uint256 i = 0; i < rewardTokens.length; i++) {
      UserRewardData storage rewardData = user.userRewardData[i];
      rewardData.lastRewardPerShare = 0;
      rewardData.unclaimedReward = 0;
    }

    pool.totalStake = pool.totalStake.sub(amount);

    if (amount > 0) {
      IERC20(pool.stakeToken).safeTransfer(msg.sender, amount);
    }

    uint256 _currBlock = getBlockNumber();
    emit EmergencyWithdraw(msg.sender, _pid, _currBlock, amount);
  }

  /**
   * @dev Harvest rewards from multiple pools for the sender
   *   combine rewards from all pools and only transfer once to save gas
   */
  function harvestMultiplePools(uint256[] calldata _pids) external override {
    address[] memory rTokens = rewardTokens;
    uint256[] memory totalRewards = new uint256[](rTokens.length);
    address account = msg.sender;
    uint256 pid;
    uint256 _currBlock = getBlockNumber();

    for (uint256 i = 0; i < _pids.length; i++) {
      pid = _pids[i];
      updatePoolRewards(pid);
      // update user reward without harvesting
      _updateUserReward(account, pid, true);

      for(uint256 j = 0; j < rTokens.length; j++) {
        uint256 reward = userInfo[pid][account].userRewardData[j].unclaimedReward;
        if (reward > 0) {
          totalRewards[j] = totalRewards[j].add(reward);
          userInfo[pid][account].userRewardData[j].unclaimedReward = 0;
          emit Harvest(account, pid, rTokens[j], reward, _currBlock);
        }
      }
    }

    for(uint256 i = 0; i < totalRewards.length; i++) {
      if (totalRewards[i] > 0) {
        _safeTransferRewards(IERC20(rTokens[i]), account, totalRewards[i]);
      }
    }
  }

  /**
   * @dev Get pending rewards of a user from a pool, mostly for front-end
   * @param _pid: id of the pool
   * @param _user: user to check for pending rewards
   */
  function pendingRewards(uint256 _pid, address _user)
    external
    override
    view
    returns (uint256[] memory rewards)
  {
    uint256 rTokensLength = rewardTokens.length;
    rewards = new uint256[](rTokensLength);
    PoolInfo storage pool = poolInfo[_pid];
    UserInfo storage user = userInfo[_pid][_user];
    uint256 _totalStake = pool.totalStake;
    uint256 _poolLastRewardBlock = pool.lastRewardBlock;
    uint32 lastAccountedBlock = _lastAccountedRewardBlock(_pid);
    for(uint256 i = 0; i < rTokensLength; i++) {
      uint256 _accRewardPerShare = pool.poolRewardData[i].accRewardPerShare;
      if (lastAccountedBlock > _poolLastRewardBlock && _totalStake != 0) {
        uint256 reward = (lastAccountedBlock - _poolLastRewardBlock)
          .mul(pool.poolRewardData[i].rewardPerBlock);
        _accRewardPerShare = _accRewardPerShare.add(reward.mul(PRECISION) / _totalStake);
      }

      rewards[i] = user.amount.mul(
        _accRewardPerShare.sub(user.userRewardData[i].lastRewardPerShare)
        ) / PRECISION;
      rewards[i] = rewards[i].add(user.userRewardData[i].unclaimedReward);
    }
  }

  /**
   * @dev Return list reward tokens
   */
  function getRewardTokens() external override view returns (address[] memory) {
    return rewardTokens;
  }

  /**
   * @dev Return full details of a pool
   */
  function getPoolInfo(uint256 _pid)
    external override view
    returns (
      uint256 totalStake,
      address stakeToken,
      uint32 startBlock,
      uint32 endBlock,
      uint32 lastRewardBlock,
      uint256 maxStakeLimit,
      uint256[] memory rewardPerBlocks,
      uint256[] memory accRewardPerShares
    )
  {
    PoolInfo storage pool = poolInfo[_pid];
    (
      totalStake,
      stakeToken,
      startBlock,
      endBlock,
      lastRewardBlock,
      maxStakeLimit
    ) = (
      pool.totalStake,
      pool.stakeToken,
      pool.startBlock,
      pool.endBlock,
      pool.lastRewardBlock,
      pool.maxStakeLimit
    );
    rewardPerBlocks = new uint256[](rewardTokens.length);
    accRewardPerShares = new uint256[](rewardTokens.length);
    for(uint256 i = 0; i < rewardTokens.length; i++) {
      rewardPerBlocks[i] = pool.poolRewardData[i].rewardPerBlock;
      accRewardPerShares[i] = pool.poolRewardData[i].accRewardPerShare;
    }
  }

  /**
   * @dev Return user's info including deposited amount and reward data
   */
  function getUserInfo(uint256 _pid, address _account)
    external override view
    returns (
      uint256 amount,
      uint256[] memory unclaimedRewards,
      uint256[] memory lastRewardPerShares
    )
  {
    UserInfo storage user = userInfo[_pid][_account];
    amount = user.amount;
    unclaimedRewards = new uint256[](rewardTokens.length);
    lastRewardPerShares = new uint256[](rewardTokens.length);
    for(uint256 i = 0; i < rewardTokens.length; i++) {
      unclaimedRewards[i] = user.userRewardData[i].unclaimedReward;
      lastRewardPerShares[i] = user.userRewardData[i].lastRewardPerShare;
    }
  }

  /**
   * @dev Harvest rewards from a pool for the sender
   * @param _pid: id of the pool
   */
  function harvest(uint256 _pid) public override {
    updatePoolRewards(_pid);
    _updateUserReward(msg.sender, _pid, true);
  }

  /**
   * @dev Update rewards for one pool
   */
  function updatePoolRewards(uint256 _pid) public override {
    require(_pid < poolLength, 'invalid pool id');
    PoolInfo storage pool = poolInfo[_pid];
    uint32 lastAccountedBlock = _lastAccountedRewardBlock(_pid);
    if (lastAccountedBlock <= pool.lastRewardBlock) return;
    uint256 _totalStake = pool.totalStake;
    if (_totalStake == 0) {
      pool.lastRewardBlock = lastAccountedBlock;
      return;
    }
    uint256 numberBlocks = lastAccountedBlock - pool.lastRewardBlock;
    for(uint256 i = 0; i < rewardTokens.length; i++) {
      PoolRewardData storage rewardData = pool.poolRewardData[i];
      uint256 reward = numberBlocks.mul(rewardData.rewardPerBlock);
      rewardData.accRewardPerShare = rewardData.accRewardPerShare.add(reward.mul(PRECISION) / _totalStake);
    }
    pool.lastRewardBlock = lastAccountedBlock;
  }

  /**
   * @dev Withdraw _amount of stakeToken from pool _pid, also harvest reward for the sender
   */
  function _withdraw(uint256 _pid, uint256 _amount) internal {
    PoolInfo storage pool = poolInfo[_pid];
    UserInfo storage user = userInfo[_pid][msg.sender];
    require(user.amount >= _amount, 'withdraw: insufficient amount');
    // update pool reward and harvest
    updatePoolRewards(_pid);
    _updateUserReward(msg.sender, _pid, true);

    user.amount = user.amount.sub(_amount);
    pool.totalStake = pool.totalStake.sub(_amount);

    IERC20(pool.stakeToken).safeTransfer(msg.sender, _amount);
    uint256 _currBlock = getBlockNumber();

    emit Withdraw(msg.sender, _pid, _currBlock, _amount);
  }

  /**
   * @dev Update reward of _to address from pool _pid, harvest if needed
   */
  function _updateUserReward(
    address _to,
    uint256 _pid,
    bool shouldHarvest
  ) internal {
    uint256 userAmount = userInfo[_pid][_to].amount;
    uint256 rTokensLength = rewardTokens.length;
    uint256 _currBlock = getBlockNumber();

    if (userAmount == 0) {
      // update user last reward per share to the latest pool reward per share
      // by right if user.amount is 0, user.unclaimedReward should be 0 as well,
      // except when user uses emergencyWithdraw function
      for(uint256 i = 0; i < rTokensLength; i++) {
        userInfo[_pid][_to].userRewardData[i].lastRewardPerShare =
          poolInfo[_pid].poolRewardData[i].accRewardPerShare;
      }
      return;
    }

    for(uint256 i = 0; i < rTokensLength; i++) {
      uint256 lastAccRewardPerShare = poolInfo[_pid].poolRewardData[i].accRewardPerShare;
      UserRewardData storage rewardData = userInfo[_pid][_to].userRewardData[i];
      // user's unclaim reward + user's amount * (pool's accRewardPerShare - user's lastRewardPerShare) / precision
      uint256 _pending = userAmount.mul(lastAccRewardPerShare.sub(rewardData.lastRewardPerShare)) / PRECISION;
      _pending = _pending.add(rewardData.unclaimedReward);

      rewardData.unclaimedReward = shouldHarvest ? 0 : _pending;
      // update user last reward per share to the latest pool reward per share
      rewardData.lastRewardPerShare = lastAccRewardPerShare;

      if (shouldHarvest && _pending > 0) {
        _safeTransferRewards(IERC20(rewardTokens[i]), _to, _pending);
        emit Harvest(_to, _pid, rewardTokens[i], _pending, _currBlock);
      }
    }
  }

  /**
   * @dev Returns current block number for arbitrum network
   */
  function getBlockNumber() public view returns (uint256 blockNumber) {
    blockNumber = ArbSys(address(100)).arbBlockNumber();
  }

  /**
   * @dev Returns last accounted reward block, either the current block number or the endBlock of the pool
   */
  function _lastAccountedRewardBlock(uint256 _pid) internal view returns (uint32 _value) {
    uint256 _currBlock = getBlockNumber();

    _value = poolInfo[_pid].endBlock;
    if (_value > _currBlock) _value = _currBlock.toUint32();
  }

  /**
   * @dev Withdraw rewards to user account
   */
  function _safeTransferRewards(IERC20 token, address _account, uint256 _amount) internal {
    if (token == IERC20(address(0))) {
      (bool success, ) = _account.call{value: _amount}('');
      require(success, 'fail to transfer');
    } else {
      token.safeTransfer(_account, _amount);
    }
  }
}