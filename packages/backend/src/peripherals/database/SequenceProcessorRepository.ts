import { Logger } from '@l2beat/common'
import { Knex } from 'knex'
import { SequenceProcessorRow } from 'knex/types/tables'

import { BaseRepository } from './shared/BaseRepository'
import { Database } from './shared/Database'

export interface SequenceProcessorRecord {
  id: string
  lastProcessed: number
}

export class SequenceProcessorRepository extends BaseRepository {
  constructor(database: Database, logger: Logger) {
    super(database, logger)

    /* eslint-disable @typescript-eslint/unbound-method */
    this.addOrUpdate = this.wrapAny(this.addOrUpdate)
    this.getById = this.wrapAny(this.getById)
    this.deleteAll = this.wrapDelete(this.deleteAll)
    /* eslint-enable @typescript-eslint/unbound-method */
  }

  async addOrUpdate(
    record: SequenceProcessorRecord,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const knex = await this.knex(trx)
    await knex('sequence_processor')
      .insert(toRow(record))
      .onConflict('id')
      .merge()
  }

  async getById(id: string): Promise<SequenceProcessorRecord | undefined> {
    const knex = await this.knex()
    const row = await knex('sequence_processor').where('id', id).first()
    return row ? toRecord(row) : undefined
  }

  async deleteAll() {
    const knex = await this.knex()
    return await knex('sequence_processor').delete()
  }
}

function toRow(record: SequenceProcessorRecord): SequenceProcessorRow {
  return {
    id: record.id,
    last_processed: record.lastProcessed,
    finished_processing_at: new Date(),
  }
}

function toRecord(row: SequenceProcessorRow): SequenceProcessorRecord {
  return {
    id: row.id,
    lastProcessed: row.last_processed,
  }
}
