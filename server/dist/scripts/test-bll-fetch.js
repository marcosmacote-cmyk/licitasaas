"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const batch_platform_monitor_service_1 = require("../services/monitoring/batch-platform-monitor.service");
const ingest_service_1 = require("../services/monitoring/ingest.service");
const prisma = new client_1.PrismaClient();
async function main() {
    const param1 = '[gkz]tVhag9IjAEiGNIXlX4u132FVSBgO7hxqSsxDl87Qy50ul/0wVjMxzQxDI0AmqYdVWO5Pt0E5iheW9PlptJOypBF3EXmEM08qOQT18Ul9EdE=';
    const processId = 'c2e7ae29-998c-4e48-9202-8221bbdb525e';
    const tenantId = '9f7a7155-be67-4470-8952-eb947fd97931';
    // Find platform BLL
    const platform = batch_platform_monitor_service_1.BATCH_PLATFORMS.find(p => p.id === 'bll');
    if (!platform)
        throw new Error('Platform not found');
    console.log('Fetching messages for param1:', param1);
    const messages = await batch_platform_monitor_service_1.BatchPlatformMonitor.fetchAllMessages(param1, platform);
    console.log(`Fetched ${messages.length} messages.`);
    if (messages.length > 0) {
        console.log('Sample message:', messages[0]);
        console.log('Latest message:', messages[messages.length - 1]);
    }
    // Try ingest
    console.log('Attempting ingest...');
    const result = await ingest_service_1.IngestService.ingestMessages(prisma, {
        processId,
        tenantId,
        messages: messages.map((m) => ({
            messageId: m.messageId,
            content: m.content,
            authorType: m.authorType,
            timestamp: m.timestamp || null,
            itemRef: m.itemRef || null,
            eventCategory: m.eventCategory || null,
            captureSource: platform.captureSource,
        })),
        captureSource: platform.captureSource,
    });
    console.log('Ingest Result:', result);
}
main().catch(console.error).finally(() => prisma.$disconnect());
