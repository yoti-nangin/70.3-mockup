import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export const sessionEvents = sqliteTable('session_events', {
  owner: text('owner').notNull(),
  session: text('session').notNull(),
  version: integer('version').notNull(),
  data: text('data').notNull(),
  createdAt: text('created_at').notNull(),
}, t => [primaryKey({ columns: [t.owner, t.session, t.version] })]);

export const activities = sqliteTable('activities', {
  owner: text('owner').notNull(),
  id: text('id').notNull(),
  data: text('data').notNull(),
}, t => [primaryKey({ columns: [t.owner, t.id] })]);
