const { ethers } = require('hardhat')

async function main() {

    // UNB contract address
    const UNB_TOKEN = "0x8dB253a1943DdDf1AF9bcF8706ac9A0Ce939d922"

    // multisig address
    const ADMIN = '0x00'

    // rewards token
    const rewardsToken = [ UNB_TOKEN ]

    const UnboundStaking = await ethers.getContractFactory('UnboundStaking')
    const und = await UnboundStaking.deploy(ADMIN, rewardsToken)

    console.log(`🎉 UnboundStaking contract Deployed to: ${und.address}`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
