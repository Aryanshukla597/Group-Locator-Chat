import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  dialect: "mysql",
  dbCredentials: process.env.DATABASE_URL
    ? { url: process.env.DATABASE_URL }
    : {
        host: "127.0.0.1",
        port: 3306,
        user: "root",
        password: "",
        database: "group_locator",
      },
});
