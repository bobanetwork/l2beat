import { Logger } from '@l2beat/backend-tools'
import { assert, assertUnreachable, notUndefined } from '@l2beat/shared-pure'

import { Config } from '../../config'
import { FinalityProjectConfig } from '../../config/features/finality'
import { BlobClient } from '../../peripherals/blobclient/BlobClient'
import { DegateClient } from '../../peripherals/degate'
import { LoopringClient } from '../../peripherals/loopring/LoopringClient'
import { ClientClass, Peripherals } from '../../peripherals/Peripherals'
import { RpcClient } from '../../peripherals/rpcclient/RpcClient'
import { StarknetClient } from '../../peripherals/starknet/StarknetClient'
import { IndexerStateRepository } from '../../tools/uif/IndexerStateRepository'
import { ApplicationModule } from '../ApplicationModule'
import { LivenessRepository } from '../tracked-txs/modules/liveness/repositories/LivenessRepository'
import { TrackedTxsConfigsRepository } from '../tracked-txs/repositories/TrackedTxsConfigsRepository'
import { TrackedTxsIndexer } from '../tracked-txs/TrackedTxsIndexer'
import { ArbitrumFinalityAnalyzer } from './analyzers/arbitrum/ArbitrumFinalityAnalyzer'
import { LineaFinalityAnalyzer } from './analyzers/LineaFinalityAnalyzer'
import { LoopringFinalityAnalyzer } from './analyzers/LoopringFinalityAnalyzer'
import { OpStackFinalityAnalyzer } from './analyzers/opStack/OpStackFinalityAnalyzer'
import { ScrollFinalityAnalyzer } from './analyzers/ScrollFinalityAnalyzer'
import { StarknetFinalityAnalyzer } from './analyzers/StarknetFinalityAnalyzer'
import { zkSyncEraFinalityAnalyzer } from './analyzers/zkSyncEraFinalityAnalyzer'
import { ZkSyncLiteFinalityAnalyzer } from './analyzers/ZkSyncLiteFinalityAnalyzer'
import { FinalityController } from './api/FinalityController'
import { createFinalityRouter } from './api/FinalityRouter'
import { FinalityIndexer } from './FinalityIndexer'
import { FinalityRepository } from './repositories/FinalityRepository'
import { FinalityConfig } from './types/FinalityConfig'

export function createFinalityModule(
  config: Config,
  logger: Logger,
  peripherals: Peripherals,
  trackedTxsIndexer: TrackedTxsIndexer | undefined,
): ApplicationModule | undefined {
  if (!config.finality) {
    logger.info('Finality module disabled')
    return
  }

  if (!trackedTxsIndexer) {
    logger.error('To run finality you have to run tracked transactions module')
    return
  }

  const finalityController = new FinalityController(
    peripherals.getRepository(LivenessRepository),
    peripherals.getRepository(FinalityRepository),
    peripherals.getRepository(TrackedTxsConfigsRepository),
    config.finality.configurations,
  )
  const finalityRouter = createFinalityRouter(finalityController)

  const ethereumClient = peripherals.getClient(RpcClient, {
    url: config.finality.ethereumProviderUrl,
    callsPerMinute: config.finality.ethereumProviderCallsPerMinute,
  })

  const blobClient = peripherals.getClient(BlobClient, {
    beaconApiUrl: config.finality.beaconApiUrl,
    rpcUrl: config.finality.ethereumProviderUrl,
    callsPerMinute: config.finality.beaconApiCPM,
    timeout: config.finality.beaconApiTimeout,
  })

  const runtimeConfigurations = initializeConfigurations(
    ethereumClient,
    blobClient,
    logger,
    peripherals.getRepository(LivenessRepository),
    config.finality.configurations,
    peripherals,
  )

  const finalityIndexers = runtimeConfigurations.map(
    (runtimeConfiguration) =>
      new FinalityIndexer(
        logger,
        trackedTxsIndexer,
        peripherals.getRepository(IndexerStateRepository),
        peripherals.getRepository(FinalityRepository),
        runtimeConfiguration,
      ),
  )

  const start = async () => {
    logger = logger.for('FinalityModule')
    logger.info('Starting...')

    for (const finalityIndexer of finalityIndexers) {
      await finalityIndexer.start()
    }
  }

  return {
    start,
    routers: [finalityRouter],
  }
}

function initializeConfigurations(
  ethereumRPC: RpcClient,
  blobClient: BlobClient,
  logger: Logger,
  livenessRepository: LivenessRepository,
  configs: FinalityProjectConfig[],
  peripherals: Peripherals,
): FinalityConfig[] {
  return configs
    .map((configuration): FinalityConfig | undefined => {
      switch (configuration.type) {
        case 'Linea':
          return {
            projectId: configuration.projectId,
            analyzer: new LineaFinalityAnalyzer(
              ethereumRPC,
              livenessRepository,
              configuration.projectId,
              getL2Rpc(configuration, peripherals, RpcClient),
            ),
            minTimestamp: configuration.minTimestamp,
          }
        case 'zkSyncEra':
          return {
            projectId: configuration.projectId,
            analyzer: new zkSyncEraFinalityAnalyzer(
              ethereumRPC,
              livenessRepository,
              configuration.projectId,
            ),
            minTimestamp: configuration.minTimestamp,
          }
        case 'OPStack-blob':
          return {
            projectId: configuration.projectId,
            analyzer: new OpStackFinalityAnalyzer(
              blobClient,
              logger,
              ethereumRPC,
              livenessRepository,
              configuration.projectId,
              {
                l2BlockTimeSeconds: configuration.l2BlockTimeSeconds,
                genesisTimestamp: configuration.genesisTimestamp,
              },
            ),
            minTimestamp: configuration.minTimestamp,
          }
        case 'Arbitrum':
          return {
            projectId: configuration.projectId,
            analyzer: new ArbitrumFinalityAnalyzer(
              blobClient,
              logger,
              ethereumRPC,
              livenessRepository,
              configuration.projectId,
            ),
            minTimestamp: configuration.minTimestamp,
          }
        case 'Scroll':
          return {
            projectId: configuration.projectId,
            analyzer: new ScrollFinalityAnalyzer(
              ethereumRPC,
              livenessRepository,
              configuration.projectId,
            ),
            minTimestamp: configuration.minTimestamp,
          }
        case 'zkSyncLite':
          return {
            projectId: configuration.projectId,
            analyzer: new ZkSyncLiteFinalityAnalyzer(
              ethereumRPC,
              livenessRepository,
              configuration.projectId,
            ),
            minTimestamp: configuration.minTimestamp,
          }
        case 'Starknet':
          return {
            projectId: configuration.projectId,
            analyzer: new StarknetFinalityAnalyzer(
              ethereumRPC,
              livenessRepository,
              configuration.projectId,
              getL2Rpc(configuration, peripherals, StarknetClient),
            ),
            minTimestamp: configuration.minTimestamp,
          }
        case 'OPStack':
          return
        case 'Loopring':
          return {
            projectId: configuration.projectId,
            analyzer: new LoopringFinalityAnalyzer(
              ethereumRPC,
              livenessRepository,
              configuration.projectId,
              getL2Rpc(configuration, peripherals, LoopringClient),
            ),
            minTimestamp: configuration.minTimestamp,
          }
        case 'Degate':
          return {
            projectId: configuration.projectId,
            analyzer: new LoopringFinalityAnalyzer(
              ethereumRPC,
              livenessRepository,
              configuration.projectId,
              getL2Rpc(configuration, peripherals, DegateClient),
            ),
            minTimestamp: configuration.minTimestamp,
          }
        default:
          assertUnreachable(configuration)
      }
    })
    .filter(notUndefined)
}

function getL2Rpc<Client, Options>(
  configuration: FinalityProjectConfig,
  peripherals: Peripherals,
  clientClass: ClientClass<Client, Options>,
) {
  assert(
    configuration.url,
    `${configuration.projectId.toString()}: L2 provider URL is not defined`,
  )

  return peripherals.getClient(clientClass, {
    url: configuration.url,
    callsPerMinute: configuration.callsPerMinute,
  } as Options)
}
