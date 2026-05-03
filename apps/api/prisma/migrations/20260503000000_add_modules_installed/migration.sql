-- Track which platform modules have completed their first-boot onInstall
-- hook. The Phase-11B module loader inserts a row the first time it sees a
-- module name and reads the row's presence on every subsequent boot to
-- short-circuit onInstall. The unique constraint on `name` doubles as the
-- idempotency guard.

CREATE TABLE "modules_installed" (
    "id"          BIGSERIAL    PRIMARY KEY,
    "name"        VARCHAR(60)  NOT NULL,
    "version"     VARCHAR(20)  NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "modules_installed_name_key" ON "modules_installed"("name");
