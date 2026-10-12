// What the examples of the docs use without declaring it: the connection of the quick start.
import type { Db, MongoClient } from 'mongodb'

declare global {
  const client: MongoClient
  const db: Db
}
