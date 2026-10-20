import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const classrooms = sqliteTable('classrooms', {
  code: text('code').primaryKey(),
  state: text('state').notNull(),
  revision: integer('revision').notNull().default(0),
  createdAt: text('created_at').notNull(),
});
export const classroomRounds = sqliteTable('classroom_rounds', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  round: integer('round').notNull(),
  answers: text('answers').notNull(),
  savedAt: text('saved_at').notNull(),
});
