-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "hourlyWageCents" INTEGER,
    "swrBps" INTEGER NOT NULL DEFAULT 400,
    "expectedReturnBps" INTEGER NOT NULL DEFAULT 700,
    "moneyDials" TEXT,
    "paymentAccountId" TEXT
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "mask" TEXT,
    "currentBalanceCents" INTEGER NOT NULL,
    "availableBalanceCents" INTEGER,
    "creditLimitCents" INTEGER,
    "aprBps" INTEGER,
    "dueDayOfMonth" INTEGER,
    "cycleCloseDayOfMonth" INTEGER,
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutopayConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "fixedAmountCents" INTEGER,
    CONSTRAINT "AutopayConfig_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Statement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "cycleStart" TEXT NOT NULL,
    "cycleEnd" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "statementBalanceCents" INTEGER NOT NULL,
    "minimumPaymentCents" INTEGER NOT NULL,
    "isEstimated" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Statement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CardPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "statementId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    CONSTRAINT "CardPayment_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "Statement" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "providerRef" TEXT,
    "date" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "rawDescriptor" TEXT NOT NULL,
    "merchantId" TEXT,
    "categoryId" TEXT,
    "confidenceBps" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "isTransfer" BOOLEAN NOT NULL DEFAULT false,
    "isSplitParent" BOOLEAN NOT NULL DEFAULT false,
    "splitParentId" TEXT,
    CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonical" TEXT NOT NULL,
    "defaultCategoryId" TEXT
);

-- CreateTable
CREATE TABLE "MerchantPattern" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    CONSTRAINT "MerchantPattern_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "icon" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "CategorizationRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "merchantId" TEXT,
    "minAmountCents" INTEGER,
    "maxAmountCents" INTEGER,
    "weekendOnly" BOOLEAN,
    "weekdayOnly" BOOLEAN,
    "accountId" TEXT,
    "categoryId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "createdFrom" TEXT,
    CONSTRAINT "CategorizationRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CategorizationRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Correction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "fromCategoryId" TEXT,
    "toCategoryId" TEXT NOT NULL,
    "becameRuleId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Correction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecurringSeries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "typicalAmountCents" INTEGER NOT NULL,
    "lastAmountCents" INTEGER NOT NULL,
    "previousAmountCents" INTEGER,
    "possiblyUnused" BOOLEAN NOT NULL DEFAULT false,
    "priceChangedAt" TEXT,
    "lastSeenAt" TEXT NOT NULL,
    "nextExpectedAt" TEXT,
    "isSubscription" BOOLEAN NOT NULL,
    CONSTRAINT "RecurringSeries_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecurringSeries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScheduledTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "nextDate" TEXT NOT NULL,
    "cadence" TEXT,
    "source" TEXT NOT NULL,
    CONSTRAINT "ScheduledTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BalanceSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "balanceCents" INTEGER NOT NULL,
    CONSTRAINT "BalanceSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetCents" INTEGER NOT NULL,
    "savedCents" INTEGER NOT NULL DEFAULT 0,
    "targetDate" TEXT,
    "monthlyContributionCents" INTEGER,
    CONSTRAINT "Goal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "monthCents" INTEGER NOT NULL,
    CONSTRAINT "Budget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Budget_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "meta" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AutopayConfig_accountId_key" ON "AutopayConfig"("accountId");

-- CreateIndex
CREATE INDEX "Statement_accountId_dueDate_idx" ON "Statement"("accountId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Statement_accountId_cycleEnd_key" ON "Statement"("accountId", "cycleEnd");

-- CreateIndex
CREATE INDEX "Transaction_accountId_date_idx" ON "Transaction"("accountId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_canonical_key" ON "Merchant"("canonical");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE INDEX "CategorizationRule_userId_idx" ON "CategorizationRule"("userId");

-- CreateIndex
CREATE INDEX "Correction_userId_idx" ON "Correction"("userId");

-- CreateIndex
CREATE INDEX "RecurringSeries_userId_idx" ON "RecurringSeries"("userId");

-- CreateIndex
CREATE INDEX "ScheduledTransaction_accountId_nextDate_idx" ON "ScheduledTransaction"("accountId", "nextDate");

-- CreateIndex
CREATE UNIQUE INDEX "BalanceSnapshot_accountId_date_key" ON "BalanceSnapshot"("accountId", "date");
