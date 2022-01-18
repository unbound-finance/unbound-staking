const { expect } = require('chai')
const { ethers } = require('hardhat')
const BigNumber = require('bignumber.js')


let unboundToken;
let unboundStaking;

const POOL_PERIOD = 1000; // in blocks
const UNB_REWARDS_PER_BLOCK = "1" // 1 UNB per block (ignoring decimals for tests)
const BLOCK_LOCK_DURATION = 150 // user can not unlock deposit before startblock + BLOCK_LOCK_DURATION blocks

describe('UnboundStaking', function () {

    beforeEach(async function () {

        signers = await ethers.getSigners()
        governance = signers[0].address

        // deploy unbound token
        let UnboundToken = await ethers.getContractFactory('UnboundToken')
        unboundToken = await UnboundToken.deploy(signers[0].address)

        // deploy unbound staking contract
        let UnboundStaking = await ethers.getContractFactory('UnboundStaking')
        unboundStaking = await UnboundStaking.deploy(signers[0].address, [unboundToken.address])
        
    })

    describe('#constructor', async () => {

        it('should set correct rewardTokens addresses', async function () {
            expect(await unboundStaking.rewardTokens(0)).to.be.equal(unboundToken.address)
        })  

        it('should set correct rewardTokens addresses', async function () {
            await expect(unboundStaking.rewardTokens(1)).to.be.reverted;
        })

        it('should set correct admin address', async function () {
            expect(await unboundStaking.admin()).to.be.equal(signers[0].address)
        })

    })

    describe('#addPool', async () => {


        it('should increase poolLength', async function () {

            expect(await unboundStaking.poolLength()).to.be.equal(0)


            let currentBlock = await ethers.provider.getBlockNumber()
            let startBlock = Number(currentBlock) + 2
            let endBlock = Number(startBlock) + POOL_PERIOD
            let releaseBlock = Number(startBlock) + BLOCK_LOCK_DURATION

            await unboundStaking.addPool(
                unboundToken.address, 
                startBlock, 
                endBlock,
                releaseBlock,
                [UNB_REWARDS_PER_BLOCK]
            );

            expect(await unboundStaking.poolLength()).to.be.equal(1)


        })

        it('should set correct poolInfo', async function () {

            let currentBlock = await ethers.provider.getBlockNumber()
            let startBlock = Number(currentBlock) + 2
            let endBlock = Number(startBlock) + POOL_PERIOD
            let releaseBlock = Number(startBlock) + BLOCK_LOCK_DURATION

            await unboundStaking.addPool(
                unboundToken.address, 
                startBlock, 
                endBlock,
                releaseBlock,
                [UNB_REWARDS_PER_BLOCK]
            );

            let poolInfo = await unboundStaking.getPoolInfo(0)

            expect(poolInfo.stakeToken).to.be.equal(unboundToken.address);
            expect(poolInfo.startBlock).to.be.equal(startBlock);
            expect(poolInfo.endBlock).to.be.equal(endBlock);
            expect(poolInfo.lastRewardBlock).to.be.equal(startBlock);
            expect(poolInfo.rewardPerBlocks[0]).to.be.equal(UNB_REWARDS_PER_BLOCK);
            expect(poolInfo.accRewardPerShares[0]).to.be.equal(0);
        })

        it('should set poolExists to true', async function () {

            expect(await unboundStaking.poolExists(unboundToken.address)).to.be.equal(false)

            let currentBlock = await ethers.provider.getBlockNumber()
            let startBlock = Number(currentBlock) + 2
            let endBlock = Number(startBlock) + POOL_PERIOD
            let maxStakingLimit = "0"

            await unboundStaking.addPool(
                unboundToken.address, 
                startBlock, 
                endBlock,
                maxStakingLimit,
                [UNB_REWARDS_PER_BLOCK]
            );

            expect(await unboundStaking.poolExists(unboundToken.address)).to.be.equal(true)

        })

        it('should set add new pool event', async function () {

            let currentBlock = await ethers.provider.getBlockNumber()
            let startBlock = Number(currentBlock) + 2
            let endBlock = Number(startBlock) + POOL_PERIOD
            let maxStakingLimit = "0"

            await expect(unboundStaking.addPool(
                unboundToken.address, 
                startBlock, 
                endBlock,
                maxStakingLimit,
                [UNB_REWARDS_PER_BLOCK]
            ))
            .to.emit(unboundStaking, "AddNewPool")
            .withArgs(unboundToken.address, startBlock, endBlock, [UNB_REWARDS_PER_BLOCK]);

        })

    })

    describe('#deposit', async () => {

        beforeEach(async function () {

            // mint unb to account for tests
            await unboundToken.mint(
                [{
                    dest: signers[1].address,
                    amount: "100"
                }]
            );

            // mint UNB token to staking contract for staking rewards
            let rewardAmount = (new BigNumber(UNB_REWARDS_PER_BLOCK).multipliedBy(POOL_PERIOD)).toFixed();
            
            await unboundToken.mint(
                [{
                    dest: unboundStaking.address,
                    amount: rewardAmount
                }]
            );

            let currentBlock = await ethers.provider.getBlockNumber()
            let startBlock = Number(currentBlock) + 500 // pool will start after 500 blocks
            let endBlock = Number(startBlock) + POOL_PERIOD
            let maxStakingLimit = "100000000000000000000000" // 1,00,000 UND

            await unboundStaking.addPool(
                unboundToken.address, 
                startBlock, 
                endBlock,
                maxStakingLimit,
                [UNB_REWARDS_PER_BLOCK]
            );

        })

        it('should revert if user deposit after pool is started', async function () {

            await mineBlocks(502) // mine blocks to pass startBlock

            await expect(unboundStaking.connect(signers[1]).deposit(0, "100"))
                .to.be.revertedWith('deposit: pool already started');

        })

        it('should revert if maximum staking limit reached', async function () {

            await expect(unboundStaking.connect(signers[1]).deposit(0, "100000000000000000000001"))
                .to.be.revertedWith('deposit: maximum stake limit reached');

        })


        it('should update user staked amount', async function () {

            let userInfoBefore = await unboundStaking.getUserInfo(0, signers[1].address);

            expect(userInfoBefore.amount).to.be.equal(0);

            await unboundToken.connect(signers[1]).approve(unboundStaking.address, "100");

            await unboundStaking.connect(signers[1]).deposit(0, "100");

            let userInfoAfter = await unboundStaking.getUserInfo(0, signers[1].address);

            expect(userInfoAfter.amount).to.be.equal(100);

        });

        it('should update total staked amount', async function () {

            let poolInfoBefore = await unboundStaking.getPoolInfo(0);

            expect(poolInfoBefore.totalStake).to.be.equal(0);

            await unboundToken.connect(signers[1]).approve(unboundStaking.address, "100");

            await unboundStaking.connect(signers[1]).deposit(0, "100");

            let poolInfoAfter = await unboundStaking.getPoolInfo(0);

            expect(poolInfoAfter.totalStake).to.be.equal("100");

        });

        it('should transfer token from user account to staking contract', async function () {

            let totalRewardAmount = (new BigNumber(UNB_REWARDS_PER_BLOCK).multipliedBy(POOL_PERIOD)).toFixed();

            expect(await unboundToken.balanceOf(signers[1].address)).to.be.equal("100");
            expect(await unboundToken.balanceOf(unboundStaking.address)).to.be.equal(totalRewardAmount);

            await unboundToken.connect(signers[1]).approve(unboundStaking.address, "100");
            await expect(unboundStaking.connect(signers[1]).deposit(0, "100"))
                .to.emit(unboundToken, "Transfer")
                .withArgs(signers[1].address, unboundStaking.address, "100");

            expect(await unboundToken.balanceOf(signers[1].address)).to.be.equal("0");

            let contractBalance = (new BigNumber(totalRewardAmount).plus("100")).toFixed();
            expect(await unboundToken.balanceOf(unboundStaking.address)).to.be.equal(contractBalance);

        })

        it('should emit Deposit event', async function () {

            await unboundToken.connect(signers[1]).approve(unboundStaking.address, "100");

            let deposit = await unboundStaking.connect(signers[1]).deposit(0, "100");

            await expect(deposit).to.emit(unboundStaking, "Deposit")
                .withArgs(signers[1].address, 0, deposit.blockNumber, "100");


        })


    });

    describe('#withdraw & withdrwaAll', async () => {

        beforeEach(async function () {

            // mint unb to account for tests
            await unboundToken.mint(
                [{
                    dest: signers[1].address,
                    amount: "100"
                },
                {
                    dest: signers[2].address,
                    amount: "300"
                },
                {
                    dest: signers[3].address,
                    amount: "600"
                }]
            );

            // mint UNB token to staking contract for staking rewards
            let rewardAmount = (new BigNumber(UNB_REWARDS_PER_BLOCK).multipliedBy(POOL_PERIOD)).toFixed();

            await unboundToken.mint(
                [{
                    dest: unboundStaking.address,
                    amount: rewardAmount
                }]
            );

            let currentBlock = await ethers.provider.getBlockNumber()
            let startBlock = Number(currentBlock) + 500
            let endBlock = Number(startBlock) + POOL_PERIOD
            let maxStakingLimit = "1000"

            await unboundStaking.addPool(
                unboundToken.address, 
                startBlock, 
                endBlock,
                maxStakingLimit,
                [UNB_REWARDS_PER_BLOCK]
            );

            // user 1 deposit 100 unb
            await unboundToken.connect(signers[1]).approve(unboundStaking.address, "100");
            await unboundStaking.connect(signers[1]).deposit(0, "100");

            // user 2 deposit 300 unb
            await unboundToken.connect(signers[2]).approve(unboundStaking.address, "300");
            await unboundStaking.connect(signers[2]).deposit(0, "300");

            // user 3 deposit 600 unb
            await unboundToken.connect(signers[3]).approve(unboundStaking.address, "600");
            await unboundStaking.connect(signers[3]).deposit(0, "600");

        })

        it('withdrawAll - should revert if pool is started and not ended', async function () {

            await mineBlocks(501); // time travel to startBlock

            let userInfoBefore1 = await unboundStaking.getUserInfo(0, signers[1].address);
            let userInfoBefore2 = await unboundStaking.getUserInfo(0, signers[2].address);
            let userInfoBefore3 = await unboundStaking.getUserInfo(0, signers[3].address);

            expect(userInfoBefore1.amount).to.be.equal(100);
            expect(userInfoBefore2.amount).to.be.equal(300);
            expect(userInfoBefore3.amount).to.be.equal(600);

            await expect(unboundStaking.connect(signers[1]).withdrawAll(0)).to.be.revertedWith('withdraw: too early');
            await expect(unboundStaking.connect(signers[2]).withdrawAll(0)).to.be.revertedWith('withdraw: too early');
            await expect(unboundStaking.connect(signers[3]).withdrawAll(0)).to.be.revertedWith('withdraw: too early');

        })

        it('withdrawAll - should decrease user deposit amount', async function () {

            await mineBlocks(1500); // time travel to endBlock

            let userInfoBefore1 = await unboundStaking.getUserInfo(0, signers[1].address);
            let userInfoBefore2 = await unboundStaking.getUserInfo(0, signers[2].address);
            let userInfoBefore3 = await unboundStaking.getUserInfo(0, signers[3].address);

            expect(userInfoBefore1.amount).to.be.equal(100);
            expect(userInfoBefore2.amount).to.be.equal(300);
            expect(userInfoBefore3.amount).to.be.equal(600);

            await unboundStaking.connect(signers[1]).withdrawAll(0);
            await unboundStaking.connect(signers[2]).withdrawAll(0);
            await unboundStaking.connect(signers[3]).withdrawAll(0);

            let userInfoAfter1 = await unboundStaking.getUserInfo(0, signers[1].address);
            let userInfoAfter2 = await unboundStaking.getUserInfo(0, signers[2].address);
            let userInfoAfter3 = await unboundStaking.getUserInfo(0, signers[3].address);

            expect(userInfoAfter1.amount).to.be.equal(0);
            expect(userInfoAfter2.amount).to.be.equal(0);
            expect(userInfoAfter3.amount).to.be.equal(0);

        })


        it('withdrawAll - should decrease total stake amount after withdraw', async function () {

            await mineBlocks(1500); // time travel to endBlock

            let poolInfo0 = await unboundStaking.getPoolInfo(0);

            expect(poolInfo0.totalStake).to.be.equal(1000);

            await unboundStaking.connect(signers[1]).withdrawAll(0);

            let poolInfo1 = await unboundStaking.getPoolInfo(0);
            expect(poolInfo1.totalStake).to.be.equal(900);

            await unboundStaking.connect(signers[2]).withdrawAll(0);

            let poolInfo2 = await unboundStaking.getPoolInfo(0);
            expect(poolInfo2.totalStake).to.be.equal(600);

            await unboundStaking.connect(signers[3]).withdrawAll(0);

            let poolInfo3 = await unboundStaking.getPoolInfo(0);
            expect(poolInfo3.totalStake).to.be.equal(0);

        })

        it('withdrawAll - should transfer unbound token from staking contract to user account on withdrawAll', async function () {

            await mineBlocks(1500); // time travel endBlock

            await expect(unboundStaking.connect(signers[1]).withdrawAll(0))
                .to.emit(unboundToken, "Transfer")
                .withArgs(unboundStaking.address, signers[1].address, "100");

            await expect(unboundStaking.connect(signers[2]).withdrawAll(0))
                .to.emit(unboundToken, "Transfer")
                .withArgs(unboundStaking.address, signers[2].address, "300");

            await expect(unboundStaking.connect(signers[3]).withdrawAll(0))
                .to.emit(unboundToken, "Transfer")
                .withArgs(unboundStaking.address, signers[3].address, "600");

        })


        it('withdrawAll - should emit withdraw event', async function () {

            await mineBlocks(1500); // time travel to endBlock

            let withdraw1 = await unboundStaking.connect(signers[1]).withdrawAll(0)
            let withdraw2 = await unboundStaking.connect(signers[2]).withdrawAll(0)
            let withdraw3 = await unboundStaking.connect(signers[3]).withdrawAll(0)

            await expect(withdraw1).to.emit(unboundStaking, "Withdraw").withArgs(signers[1].address, 0, withdraw1.blockNumber, "100")
            await expect(withdraw2).to.emit(unboundStaking, "Withdraw").withArgs(signers[2].address, 0, withdraw2.blockNumber, "300")
            await expect(withdraw3).to.emit(unboundStaking, "Withdraw").withArgs(signers[3].address, 0, withdraw3.blockNumber, "600")
                
        })

        it('withdrawAll - should receive unb reward while withdrawing', async function () {
            
            await unboundStaking.updatePoolRewards(0)
            await mineBlocks(1501)   // mine blocks for rewards


            let withdraw1 = await unboundStaking.connect(signers[1]).withdrawAll(0)
            let withdraw2 = await unboundStaking.connect(signers[2]).withdrawAll(0)
            let withdraw3 = await unboundStaking.connect(signers[3]).withdrawAll(0)

            await expect(withdraw1).to.emit(unboundToken, "Transfer").withArgs(unboundStaking.address, signers[1].address, "100")
            await expect(withdraw2).to.emit(unboundToken, "Transfer").withArgs(unboundStaking.address, signers[2].address, "300")
            await expect(withdraw3).to.emit(unboundToken, "Transfer").withArgs(unboundStaking.address, signers[3].address, "600")
                
        })

        it('withdrawAll - should revert if pool is started and not ended', async function () {

            await mineBlocks(501); // time travel to startBlock

            let userInfoBefore1 = await unboundStaking.getUserInfo(0, signers[1].address);
            let userInfoBefore2 = await unboundStaking.getUserInfo(0, signers[2].address);
            let userInfoBefore3 = await unboundStaking.getUserInfo(0, signers[3].address);

            expect(userInfoBefore1.amount).to.be.equal(100);
            expect(userInfoBefore2.amount).to.be.equal(300);
            expect(userInfoBefore3.amount).to.be.equal(600);

            await expect(unboundStaking.connect(signers[1]).withdraw(0, 50)).to.be.revertedWith('withdraw: too early');
            await expect(unboundStaking.connect(signers[2]).withdraw(0, 150)).to.be.revertedWith('withdraw: too early');
            await expect(unboundStaking.connect(signers[3]).withdraw(0, 300)).to.be.revertedWith('withdraw: too early');

        })

        it('withdraw - should decrease user deposit amount', async function () {

            await mineBlocks(1500); // time travel to endBlock

            let userInfoBefore1 = await unboundStaking.getUserInfo(0, signers[1].address);
            let userInfoBefore2 = await unboundStaking.getUserInfo(0, signers[2].address);
            let userInfoBefore3 = await unboundStaking.getUserInfo(0, signers[3].address);

            expect(userInfoBefore1.amount).to.be.equal(100);
            expect(userInfoBefore2.amount).to.be.equal(300);
            expect(userInfoBefore3.amount).to.be.equal(600);

            await unboundStaking.connect(signers[1]).withdraw(0, 50);
            await unboundStaking.connect(signers[2]).withdraw(0, 150);
            await unboundStaking.connect(signers[3]).withdraw(0, 300);

            let userInfoAfter1 = await unboundStaking.getUserInfo(0, signers[1].address);
            let userInfoAfter2 = await unboundStaking.getUserInfo(0, signers[2].address);
            let userInfoAfter3 = await unboundStaking.getUserInfo(0, signers[3].address);

            expect(userInfoAfter1.amount).to.be.equal(50);
            expect(userInfoAfter2.amount).to.be.equal(150);
            expect(userInfoAfter3.amount).to.be.equal(300);

        })


        it('withdraw - should decrease total stake amount after withdraw', async function () {

            await mineBlocks(1500); // time travel to endBlock

            let poolInfo0 = await unboundStaking.getPoolInfo(0);

            expect(poolInfo0.totalStake).to.be.equal(1000);

            await unboundStaking.connect(signers[1]).withdraw(0, 50);

            let poolInfo1 = await unboundStaking.getPoolInfo(0);
            expect(poolInfo1.totalStake).to.be.equal(950);

            await unboundStaking.connect(signers[2]).withdraw(0, 150);

            let poolInfo2 = await unboundStaking.getPoolInfo(0);
            expect(poolInfo2.totalStake).to.be.equal(800);

            await unboundStaking.connect(signers[3]).withdraw(0, 300);

            let poolInfo3 = await unboundStaking.getPoolInfo(0);
            expect(poolInfo3.totalStake).to.be.equal(500);

        })

        it('withdraw - should transfer unbound token from staking contract to user account on withdraw', async function () {

            await mineBlocks(1500); // time travel to endBlock

            await expect(unboundStaking.connect(signers[1]).withdraw(0, "50"))
                .to.emit(unboundToken, "Transfer")
                .withArgs(unboundStaking.address, signers[1].address, "50");

            await expect(unboundStaking.connect(signers[2]).withdraw(0, "150"))
                .to.emit(unboundToken, "Transfer")
                .withArgs(unboundStaking.address, signers[2].address, "150");

            await expect(unboundStaking.connect(signers[3]).withdraw(0, "300"))
                .to.emit(unboundToken, "Transfer")
                .withArgs(unboundStaking.address, signers[3].address, "300");

        })

        it('withdraw - should emit withdraw event', async function () {

            await mineBlocks(1500); // time travel to endBlock

            let withdraw1 = await unboundStaking.connect(signers[1]).withdraw(0, "50")
            let withdraw2 = await unboundStaking.connect(signers[2]).withdraw(0, "150")
            let withdraw3 = await unboundStaking.connect(signers[3]).withdraw(0, "300")

            await expect(withdraw1).to.emit(unboundStaking, "Withdraw").withArgs(signers[1].address, 0, withdraw1.blockNumber, "50")
            await expect(withdraw2).to.emit(unboundStaking, "Withdraw").withArgs(signers[2].address, 0, withdraw2.blockNumber, "150")
            await expect(withdraw3).to.emit(unboundStaking, "Withdraw").withArgs(signers[3].address, 0, withdraw3.blockNumber, "300")
                
        })

        it('withdraw - should receive unb reward while withdrawing', async function () {
            
            await unboundStaking.updatePoolRewards(0)
            await mineBlocks(1500)   // mine blocks for rewards


            let withdraw1 = await unboundStaking.connect(signers[1]).withdraw(0, "50")
            let withdraw2 = await unboundStaking.connect(signers[2]).withdraw(0, "150")
            let withdraw3 = await unboundStaking.connect(signers[3]).withdraw(0, "300")

            await expect(withdraw1).to.emit(unboundToken, "Transfer").withArgs(unboundStaking.address, signers[1].address, "100")
            await expect(withdraw2).to.emit(unboundToken, "Transfer").withArgs(unboundStaking.address, signers[2].address, "300")
            await expect(withdraw3).to.emit(unboundToken, "Transfer").withArgs(unboundStaking.address, signers[3].address, "600")
                
        })

        it('withdrawAll - should revert if call after startBlock and before endBlock', async function () {

            await mineBlocks(800)

            await expect(unboundStaking.connect(signers[1]).withdrawAll(0))
                .to.be.revertedWith("withdraw: too early");
        })

        it('withdraw - should revert if call before releaseBlock', async function () {

            await mineBlocks(800)

            await expect(unboundStaking.connect(signers[1]).withdraw(0, "50"))
                .to.be.revertedWith("withdraw: too early");
        })


    })

    describe('#harvest', async () => {

        let startBlock;

        beforeEach(async function () {

            // mint unb to account for tests
            await unboundToken.mint(
                [{
                    dest: signers[1].address,
                    amount: "100"
                },
                {
                    dest: signers[2].address,
                    amount: "300"
                },
                {
                    dest: signers[3].address,
                    amount: "600"
                }]
            );

            // mint UNB token to staking contract for staking rewards
            let rewardAmount = (new BigNumber(UNB_REWARDS_PER_BLOCK).multipliedBy(POOL_PERIOD)).toFixed();

            await unboundToken.mint(
                [{
                    dest: unboundStaking.address,
                    amount: rewardAmount
                }]
            );

            let currentBlock = await ethers.provider.getBlockNumber()
            startBlock = Number(currentBlock) + 500
            let endBlock = Number(startBlock) + POOL_PERIOD
            let maxStakingLimit = "1000"

            await unboundStaking.addPool(
                unboundToken.address, 
                startBlock, 
                endBlock,
                maxStakingLimit,
                [UNB_REWARDS_PER_BLOCK]
            );

            // user 1 deposit 100 unb
            await unboundToken.connect(signers[1]).approve(unboundStaking.address, "100");
            await unboundStaking.connect(signers[1]).deposit(0, "100");

            // user 2 deposit 300 unb
            await unboundToken.connect(signers[2]).approve(unboundStaking.address, "300");
            await unboundStaking.connect(signers[2]).deposit(0, "300");

            // user 3 deposit 600 unb
            await unboundToken.connect(signers[3]).approve(unboundStaking.address, "600");
            await unboundStaking.connect(signers[3]).deposit(0, "600");

        })

        it('should update pool rewards', async function () {
            let poolInfoBefore = await unboundStaking.getPoolInfo(0)

            expect(poolInfoBefore.lastRewardBlock).to.be.equal(startBlock);
            expect(poolInfoBefore.accRewardPerShares[0]).to.be.equal("0");

            await mineBlocks(500) // mine blocks to startBlock
            let harvest = await unboundStaking.harvest(0);

            let poolInfoAfter = await unboundStaking.getPoolInfo(0)

            expect(poolInfoAfter.lastRewardBlock).to.be.equal(harvest.blockNumber);
            expect(poolInfoAfter.accRewardPerShares[0]).to.be.equal("8000000000");

            await mineBlocks(800) // mine few more blokcs

            let harvest2 = await unboundStaking.harvest(0);

            let poolInfoAfter2 = await unboundStaking.getPoolInfo(0)

            expect(poolInfoAfter2.lastRewardBlock).to.be.equal(harvest2.blockNumber);
            expect(poolInfoAfter2.accRewardPerShares[0]).to.be.equal("809000000000");


        })

        it('should update user rewards', async function () {
            let userInfoBefore = await unboundStaking.getUserInfo(0, signers[1].address);

            expect(userInfoBefore.unclaimedRewards[0]).to.be.equal(0);
            expect(userInfoBefore.lastRewardPerShares[0]).to.be.equal(0);

            await mineBlocks(500) // mine blocks to startBlock
            await unboundStaking.connect(signers[1]).harvest(0);

            let userInfoAfter = await unboundStaking.getUserInfo(0, signers[1].address);

            expect(userInfoAfter.unclaimedRewards[0]).to.be.equal(0);
            expect(userInfoAfter.lastRewardPerShares[0]).to.be.equal(8000000000);

            await mineBlocks(700) // mine few more blokcs

            await unboundStaking.connect(signers[1]).harvest(0);

            let userInfoAfter2 = await unboundStaking.getUserInfo(0, signers[1].address);

            expect(userInfoAfter2.unclaimedRewards[0]).to.be.equal(70);
            expect(userInfoAfter2.lastRewardPerShares[0]).to.be.equal(709000000000);

        })

        it('should transfer rewards linearly & emit harvest event', async function () {

            await mineBlocks(510) // mine blocks to startBlock

            await unboundStaking.connect(signers[1]).harvest(0)
            await unboundStaking.connect(signers[2]).harvest(0)
            await unboundStaking.connect(signers[3]).harvest(0)

            expect((await unboundStaking.getUserInfo(0, signers[1].address)).unclaimedRewards[0]).to.eq(1)
            expect((await unboundStaking.getUserInfo(0, signers[2].address)).unclaimedRewards[0]).to.eq(5)
            expect((await unboundStaking.getUserInfo(0, signers[3].address)).unclaimedRewards[0]).to.eq(12)


            await mineBlocks(500); // mine few more blocks

            await unboundStaking.connect(signers[1]).harvest(0)
            await unboundStaking.connect(signers[2]).harvest(0)
            await unboundStaking.connect(signers[3]).harvest(0)

            expect((await unboundStaking.getUserInfo(0, signers[1].address)).unclaimedRewards[0]).to.eq(51)
            expect((await unboundStaking.getUserInfo(0, signers[2].address)).unclaimedRewards[0]).to.eq(155)
            expect((await unboundStaking.getUserInfo(0, signers[3].address)).unclaimedRewards[0]).to.eq(313)

        })

        it('should transfer rewards & emit Transfer event', async function () {

            await mineBlocks(1500); // time travel to endBlock

            await expect(unboundStaking.connect(signers[1]).harvest(0))
                .to.emit(unboundToken, "Transfer")
                .withArgs(unboundStaking.address, signers[1].address, "100")

            await expect(unboundStaking.connect(signers[2]).harvest(0))
                .to.emit(unboundToken, "Transfer")
                .withArgs(unboundStaking.address, signers[2].address, "300")

            await expect(unboundStaking.connect(signers[3]).harvest(0))
                .to.emit(unboundToken, "Transfer")
                .withArgs(unboundStaking.address, signers[3].address, "600")
            
        })

        it('should increment unclaimedAmount if endBlock is not passed yet & set it to 0 once endBlock passed', async function () {

            let userInfo1 = await unboundStaking.getUserInfo(0, signers[1].address);
            let userInfo2 = await unboundStaking.getUserInfo(0, signers[2].address);
            let userInfo3 = await unboundStaking.getUserInfo(0, signers[3].address);

            expect(userInfo1.unclaimedRewards[0]).to.be.equal(0);
            expect(userInfo2.unclaimedRewards[0]).to.be.equal(0);
            expect(userInfo3.unclaimedRewards[0]).to.be.equal(0);

            await mineBlocks(510);

            await unboundStaking.connect(signers[1]).harvest(0)
            await unboundStaking.connect(signers[2]).harvest(0)
            await unboundStaking.connect(signers[3]).harvest(0)

            await unboundStaking.getUserInfo(0, signers[1].address);
            await unboundStaking.getUserInfo(0, signers[2].address);
            await unboundStaking.getUserInfo(0, signers[3].address);

            expect((await unboundStaking.getUserInfo(0, signers[1].address)).unclaimedRewards[0]).to.eq(1);
            expect((await unboundStaking.getUserInfo(0, signers[2].address)).unclaimedRewards[0]).to.eq(5);
            expect((await unboundStaking.getUserInfo(0, signers[3].address)).unclaimedRewards[0]).to.eq(12);

            await mineBlocks(600);

            await unboundStaking.connect(signers[1]).harvest(0);
            await unboundStaking.connect(signers[2]).harvest(0);
            await unboundStaking.connect(signers[3]).harvest(0);

            expect((await unboundStaking.getUserInfo(0, signers[1].address)).unclaimedRewards[0]).to.eq(61)
            expect((await unboundStaking.getUserInfo(0, signers[2].address)).unclaimedRewards[0]).to.eq(185)
            expect((await unboundStaking.getUserInfo(0, signers[3].address)).unclaimedRewards[0]).to.eq(373)

            await mineBlocks(500); // mined endBlock

            let harvest1 = await unboundStaking.connect(signers[1]).harvest(0);
            let harvest2 = await unboundStaking.connect(signers[2]).harvest(0);
            let harvest3 = await unboundStaking.connect(signers[3]).harvest(0);
            
            await expect(harvest1).to.emit(unboundStaking, "Harvest")
                .withArgs(signers[1].address, 0, unboundToken.address, "98", harvest1.blockNumber)

            await expect(harvest2).to.emit(unboundStaking, "Harvest")
                .withArgs(signers[2].address, 0, unboundToken.address, "298", harvest2.blockNumber)

            await expect(harvest3).to.emit(unboundStaking, "Harvest")
                .withArgs(signers[3].address, 0, unboundToken.address, "599", harvest3.blockNumber) 

            expect((await unboundStaking.getUserInfo(0, signers[1].address)).unclaimedRewards[0]).to.eq(0)
            expect((await unboundStaking.getUserInfo(0, signers[2].address)).unclaimedRewards[0]).to.eq(0)
            expect((await unboundStaking.getUserInfo(0, signers[3].address)).unclaimedRewards[0]).to.eq(0)

            
        })

    })

    describe('#emergencyWith', async () => {

        beforeEach(async function () {

            // mint unb to account for tests
            await unboundToken.mint(
                [{
                    dest: signers[1].address,
                    amount: "100"
                }]
            );

            // mint UNB token to staking contract for staking rewards
            let rewardAmount = (new BigNumber(UNB_REWARDS_PER_BLOCK).multipliedBy(POOL_PERIOD)).toFixed();

            await unboundToken.mint(
                [{
                    dest: unboundStaking.address,
                    amount: rewardAmount
                }]
            );

            let currentBlock = await ethers.provider.getBlockNumber()
            startBlock = Number(currentBlock) + 500
            let endBlock = Number(startBlock) + POOL_PERIOD
            let maxStakeLimit = "1000"

            await unboundStaking.addPool(
                unboundToken.address, 
                startBlock, 
                endBlock,
                maxStakeLimit,
                [UNB_REWARDS_PER_BLOCK]
            );

            // user 1 deposit 100 unb
            await unboundToken.connect(signers[1]).approve(unboundStaking.address, "100");
            await unboundStaking.connect(signers[1]).deposit(0, "100");

        })

        it('should revert if emergency exit is not allowed', async function () {

            await expect(unboundStaking.connect(signers[1]).emergencyWithdraw(0))
                .to.be.revertedWith("emergencyWithdraw: not allowed at the moment")
        })

        it('should set all values to 0 & reduce total staked amount', async function () {

            await unboundStaking.changeEmergencyExits(true);

            await mineBlocks(500);
            await unboundStaking.connect(signers[1]).harvest(0);

            let userInfoBefore = await unboundStaking.getUserInfo(0, signers[1].address);
            let poolInfoBefore = await unboundStaking.getPoolInfo(0);

            expect(userInfoBefore.amount).to.be.equal(100);
            expect(userInfoBefore.lastRewardPerShares[0]).to.be.equal(50000000000);
            expect(poolInfoBefore.totalStake).to.be.equal(100);

            await unboundStaking.connect(signers[1]).emergencyWithdraw(0);

            let userInfoAfter = await unboundStaking.getUserInfo(0, signers[1].address);
            let poolInfoAfter = await unboundStaking.getPoolInfo(0);

            expect(userInfoAfter.amount).to.be.equal(0);
            expect(userInfoAfter.lastRewardPerShares[0]).to.be.equal(0);
            expect(poolInfoAfter.totalStake).to.be.equal(0);

        })


        it('should transfer deposited token to user', async function () {

            await unboundStaking.changeEmergencyExits(true);

            await expect(unboundStaking.connect(signers[1]).emergencyWithdraw(0))
                .to.emit(unboundToken, "Transfer")
                .withArgs(unboundStaking.address, signers[1].address, "100");

        })

        it('should emit emergency withdraw event', async function () {

            await unboundStaking.changeEmergencyExits(true);

            let withdraw = await unboundStaking.connect(signers[1]).emergencyWithdraw(0);

            await expect(withdraw)
                .to.emit(unboundStaking, "EmergencyWithdraw")
                .withArgs(signers[1].address, 0, withdraw.blockNumber, "100");

        })

    })

    describe('#adminWithdraw', async () => {

        beforeEach(async function () {

            // mint unb to account for tests
            await unboundToken.mint(
                [{
                    dest: signers[1].address,
                    amount: "100"
                }]
            );

            // mint UNB token to staking contract for staking rewards
            let rewardAmount = (new BigNumber(UNB_REWARDS_PER_BLOCK).multipliedBy(POOL_PERIOD)).toFixed();

            await unboundToken.mint(
                [{
                    dest: unboundStaking.address,
                    amount: rewardAmount
                }]
            );

            let currentBlock = await ethers.provider.getBlockNumber()
            startBlock = Number(currentBlock) + 500
            let endBlock = Number(startBlock) + POOL_PERIOD
            let maxStakeLimit = "1000"

            await unboundStaking.addPool(
                unboundToken.address, 
                startBlock, 
                endBlock,
                maxStakeLimit,
                [UNB_REWARDS_PER_BLOCK]
            );

            // user 1 deposit 100 unb
            await unboundToken.connect(signers[1]).approve(unboundStaking.address, "100");
            await unboundStaking.connect(signers[1]).deposit(0, "100");

        })

        it('should revert if call is not admin', async function () {

            await expect(unboundStaking.connect(signers[1]).adminWithdraw(0, "100"))
                .to.be.revertedWith('only admin');

        });

        it('should transfer reward token from staking contract to admin', async function () {

            await expect(unboundStaking.adminWithdraw(0, "1"))
                .to.emit(unboundToken, "Transfer")
                .withArgs(unboundStaking.address, signers[0].address, "1")

        
            await expect(unboundStaking.adminWithdraw(0, "2"))
                .to.emit(unboundToken, "Transfer")
                .withArgs(unboundStaking.address, signers[0].address, "2")

            await expect(unboundStaking.adminWithdraw(0, "1097"))
                .to.emit(unboundToken, "Transfer")
                .withArgs(unboundStaking.address, signers[0].address, "1097")

        })

    })
})

async function mineBlocks(count){
    return new Promise(async function(resolve, reject){
      for(i=1; i<=count; i++){
        await network.provider.send("evm_mine");
        if(i == count){
          resolve(true);
        }
      }
    })
  }