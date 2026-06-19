import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// TODO: Add your tables here

/**
 * Rollout table: tracks AI model deployment rollouts
 */
export const rollouts = mysqlTable("rollouts", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  name: varchar("name", { length: 255 }).notNull(),
  state: mysqlEnum("state", ["created", "shadow", "canary", "promoted", "rolled_back", "paused"]).default("created").notNull(),
  baselineModel: varchar("baselineModel", { length: 255 }).notNull(),
  candidateModel: varchar("candidateModel", { length: 255 }).notNull(),
  baselineSystemPrompt: text("baselineSystemPrompt"),
  candidateSystemPrompt: text("candidateSystemPrompt"),
  currentWeight: int("currentWeight").default(0).notNull(),
  targetWeight: int("targetWeight").default(100).notNull(),
  rollbackThreshold: int("rollbackThreshold").default(70).notNull(),
  advanceThreshold: int("advanceThreshold").default(90).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Rollout = typeof rollouts.$inferSelect;
export type InsertRollout = typeof rollouts.$inferInsert;

/**
 * Metrics table: stores quality scores, latency, error rates
 */
export const metrics = mysqlTable("metrics", {
  id: varchar("id", { length: 64 }).primaryKey(),
  rolloutId: varchar("rolloutId", { length: 64 }).notNull().references(() => rollouts.id),
  role: mysqlEnum("role", ["baseline", "candidate"]).notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  avgQuality: int("avgQuality").notNull(),
  p95Latency: int("p95Latency").notNull(),
  errorRate: int("errorRate").notNull(),
  requestCount: int("requestCount").notNull(),
});

export type Metric = typeof metrics.$inferSelect;
export type InsertMetric = typeof metrics.$inferInsert;

/**
 * Decisions table: logs all controller decisions (advance, rollback, promote)
 */
export const decisions = mysqlTable("decisions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  rolloutId: varchar("rolloutId", { length: 64 }).notNull().references(() => rollouts.id),
  action: mysqlEnum("action", ["advance", "rollback", "promote", "pause"]).notNull(),
  reason: text("reason"),
  previousWeight: int("previousWeight"),
  newWeight: int("newWeight"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Decision = typeof decisions.$inferSelect;
export type InsertDecision = typeof decisions.$inferInsert;

/**
 * Rollout steps table: tracks canary progression steps
 */
export const rolloutSteps = mysqlTable("rolloutSteps", {
  id: varchar("id", { length: 64 }).primaryKey(),
  rolloutId: varchar("rolloutId", { length: 64 }).notNull().references(() => rollouts.id),
  stepNumber: int("stepNumber").notNull(),
  targetWeight: int("targetWeight").notNull(),
  gateExpression: text("gateExpression"),
  status: mysqlEnum("status", ["pending", "active", "passed", "failed"]).default("pending").notNull(),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
});

export type RolloutStep = typeof rolloutSteps.$inferSelect;
export type InsertRolloutStep = typeof rolloutSteps.$inferInsert;
