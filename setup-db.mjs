import mysql from "mysql2/promise";

const conn = await mysql.createConnection({
  host: "127.0.0.1",
  port: 3306,
  user: "root",
  password: "",
  database: "group_locator",
});

console.log("Connected to MySQL!");

// Drop tables to recreate with new schemas
await conn.execute("DROP TABLE IF EXISTS messages");
await conn.execute("DROP TABLE IF EXISTS meeting_points");
await conn.execute("DROP TABLE IF EXISTS locations");
await conn.execute("DROP TABLE IF EXISTS members");
await conn.execute("DROP TABLE IF EXISTS `groups`");
console.log("🗑️ Dropped existing tables for recreation");

await conn.execute(`
  CREATE TABLE \`groups\` (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    invite_code VARCHAR(20) NOT NULL UNIQUE,
    is_locked TINYINT(1) NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log("✅ groups table created");

await conn.execute(`
  CREATE TABLE \`members\` (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    group_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    token VARCHAR(64) NOT NULL UNIQUE,
    role VARCHAR(20) NOT NULL DEFAULT 'member',
    is_location_sharing TINYINT(1) NOT NULL DEFAULT 1,
    is_online TINYINT(1) NOT NULL DEFAULT 1,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    last_read_message_id VARCHAR(36) NULL,
    joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_group_user (group_id, user_id)
  )
`);
console.log("✅ members table created");

await conn.execute(`
  CREATE TABLE IF NOT EXISTS \`locations\` (
    member_id VARCHAR(36) PRIMARY KEY,
    member_name VARCHAR(100) NOT NULL,
    group_id VARCHAR(36) NOT NULL,
    latitude DOUBLE,
    longitude DOUBLE,
    accuracy DOUBLE,
    is_sharing TINYINT(1) NOT NULL DEFAULT 1,
    is_online TINYINT(1) NOT NULL DEFAULT 1,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY group_id_idx (group_id)
  )
`);
console.log("✅ locations table created");

await conn.execute(`
  CREATE TABLE IF NOT EXISTS \`meeting_points\` (
    id VARCHAR(36) PRIMARY KEY,
    group_id VARCHAR(36) NOT NULL UNIQUE,
    latitude DOUBLE NOT NULL,
    longitude DOUBLE NOT NULL,
    label VARCHAR(200),
    set_by_name VARCHAR(100) NOT NULL,
    set_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log("✅ meeting_points table created");

await conn.execute(`
  CREATE TABLE IF NOT EXISTS \`messages\` (
    id VARCHAR(36) PRIMARY KEY,
    group_id VARCHAR(36) NOT NULL,
    member_id VARCHAR(36),
    member_name VARCHAR(100) NOT NULL,
    content TEXT NOT NULL,
    type VARCHAR(20) NOT NULL DEFAULT 'chat',
    is_pinned TINYINT(1) NOT NULL DEFAULT 0,
    reply_to_id VARCHAR(36) NULL,
    reply_to_name VARCHAR(100) NULL,
    reply_to_content TEXT NULL,
    is_edited TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY group_id_idx (group_id)
  )
`);
console.log("✅ messages table created");

await conn.end();
console.log("\n🎉 All tables created successfully!");
