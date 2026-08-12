import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const dailyUsage = sqliteTable("daily_usage", {
  key: text("key").primaryKey(),
  day: text("day").notNull(),
  count: integer("count").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

export const costBudget = sqliteTable("cost_budget", {
  key: text("key").primaryKey(),
  spentMicros: integer("spent_micros").notNull().default(0),
  reservedMicros: integer("reserved_micros").notNull().default(0),
  limitMicros: integer("limit_micros").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const costReservations = sqliteTable("cost_reservations", {
  id: text("id").primaryKey(),
  budgetKey: text("budget_key").notNull(),
  reservedMicros: integer("reserved_micros").notNull(),
  actualMicros: integer("actual_micros"),
  settled: integer("settled").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const researchSessions = sqliteTable("research_sessions", {
  idHash: text("id_hash").primaryKey(),
  payloadJson: text("payload_json").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});
