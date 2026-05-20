import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { extractConfigFromBidding, extractEncargosFromBidding } from '../server/services/engineering/configAiExtractor';

dotenv.config({ path: path.join(__dirname, '../server/.env') });

const prisma = new PrismaClient();

async function main() {
    const bidding = await prisma.biddingProcess.findFirst({
        orderBy: { sessionDate: 'desc' }
    });

    if (!bidding) {
        console.error('No bidding process found in database');
        return;
    }

    console.log(`Testing extraction on bidding ID: ${bidding.id}`);
    console.log(`Title: ${bidding.title}`);
    console.log(`PNCP Link: ${bidding.pncpLink}`);

    console.log('\n--- EXTRACT CONFIG ---');
    const configResult = await extractConfigFromBidding(bidding.id);
    console.log('Config Result:', JSON.stringify(configResult, null, 2));

    console.log('\n--- EXTRACT ENCARGOS ---');
    const encargosResult = await extractEncargosFromBidding(bidding.id);
    console.log('Encargos Result:', JSON.stringify(encargosResult, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
