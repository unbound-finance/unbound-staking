const { ethers } = require('hardhat')

async function main() {

    // UNB contract address
    const UNB_TOKEN = "0x8dB253a1943DdDf1AF9bcF8706ac9A0Ce939d922"

    // UNB staking contract address
    const UNBOUND_STAKING_CONTRACT = ""

    let startBlock = "";
    let endBlock = "";
    let maxStakingLimit = "";
    let unbRewardsPerBlock = "";

    const unboundStaking = await ethers.getContractAt('UnboundStaking', UNBOUND_STAKING_CONTRACT);

    let add = await unboundStaking.addPool(
        UNB_TOKEN,
        startBlock,
        endBlock,
        maxStakingLimit,
        [unbRewardsPerBlock]
    )

    console.log('tx sent: ', add);

    // then transfer total rewards amount to unbound staking contract
    // amount to transfer = unbRewardsPerBlock * pool block duration (endBock -ddddd startBlock)

}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
