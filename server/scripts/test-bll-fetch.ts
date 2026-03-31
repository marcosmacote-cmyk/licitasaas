import { PrismaClient } from '@prisma/client';
import { BatchPlatformMonitor, BATCH_PLATFORMS } from '../services/monitoring/batch-platform-monitor.service';
import { IngestService } from '../services/monitoring/ingest.service';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
    const param1 = '[gkz]tVhag9IjAEiGNIXlX4u132FVSBgO7hxqSsxDl87Qy50ul/0wVjMxzQxDI0AmqYdVWO5Pt0E5iheW9PlptJOypBF3EXmEM08qOQT18Ul9EdE=';
    const processId = 'c2e7ae29-998c-4e48-9202-8221bbdb525e';
    const tenantId = '9f7a7155-be67-4470-8952-eb947fd97931';
    
    // Find platform BLL
    const platform = BATCH_PLATFORMS.find(p => p.id === 'bll');
    if (!platform) throw new Error('Platform not found');

    console.log('Fetching messages for param1:', param1);
    const messages = await BatchPlatformMonitor.fetchAllMessages(param1, platform);
    console.log(`Fetched ${messages.length} messages.`);
    
    if (messages.length > 0) {
        console.log('Sample message:', messages[0]);
        console.log('Latest message:', messages[messages.length - 1]);
    }

    // Try ingest
    console.log('Attempting ingest...');
    const result = await IngestService.ingestMessages(prisma, {
        processId,
        tenantId,
        messages: messages.map((m: any) => ({
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
