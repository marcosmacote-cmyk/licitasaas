import { EngineeringComposition, EngineeringCompositionItem, EngineeringItem } from '@prisma/client';
import prisma from '../../lib/prisma';

export interface FlattenedItem {
  type: string; // 'MATERIAL', 'MAO_DE_OBRA', 'EQUIPAMENTO', 'COMPOSICAO_AUXILIAR'
  code: string;
  sourceName: string;
  description: string;
  unit: string;
  coefficient: number;
  unitPrice: number;
  totalPrice: number;
  coefficientExpression?: string | null;
  groupKey?: string | null;
}

export interface FlattenedComposition {
  id: string;
  code: string;
  sourceName: string;
  description: string;
  unit: string;
  totalPrice: number;
  items: FlattenedItem[];
  isAuxiliary: boolean;
  itemNumbers: string[]; // Budget item numbers linked to this composition
  metadata?: any;
  
  // Footer calculation fields
  totalMoSemLs: number;
  totalLs: number;
  totalMoComLs: number;
  totalMaterial: number;
  totalEquipamento: number;
  valorBdi: number;
  valorComBdi: number;
  proposalQuantity: number;
  proposalTotal: number;
}

export interface FlattenedReport {
  principalCompositions: FlattenedComposition[];
  auxiliaryCompositions: FlattenedComposition[];
}

export class CompositionFlattener {
  private visitedAuxiliaries = new Map<string, FlattenedComposition>();
  private bdi: number;
  private lsPercentage: number; // Caller-provided, e.g. 0.8464 for horista 84.64%

  /**
   * @param bdi BDI as decimal (e.g. 0.25 for 25%)
   * @param lsPercentage Leis Sociais as decimal (e.g. 1.143 for horista 114.3%)
   *   FIX ARQ-05: This is no longer hardcoded — the route passes the actual configured value.
   */
  constructor(bdi: number = 0, lsPercentage: number = 0.8464) {
    this.bdi = bdi;
    this.lsPercentage = lsPercentage;
  }

  /**
   * Flattens all compositions within a given proposal.
   */
  public async flattenProposal(proposalId: string, providedItems?: any[]): Promise<FlattenedReport> {
    const proposalItems = providedItems || await prisma.engineeringProposalItem.findMany({
      where: { proposalId },
      orderBy: { sortOrder: 'asc' },
    });

    const principalCompositions: FlattenedComposition[] = [];

    // Aggregate quantities by code, preserving all itemNumbers
    const aggregatedItems = new Map<string, { code: string, sourceName: string, quantity: number, itemNumbers: string[] }>();
    for (const pItem of proposalItems) {
      if (!pItem.code || pItem.code === 'N/A') continue;
      const codeStr = pItem.code.toUpperCase();
      const qty = typeof pItem.quantity === 'number' ? pItem.quantity : 1;
      const itemNum = (pItem as any).itemNumber || '';
      
      if (aggregatedItems.has(codeStr)) {
        aggregatedItems.get(codeStr)!.quantity += qty;
        if (itemNum && !aggregatedItems.get(codeStr)!.itemNumbers.includes(itemNum)) {
          aggregatedItems.get(codeStr)!.itemNumbers.push(itemNum);
        }
      } else {
        aggregatedItems.set(codeStr, { code: pItem.code, sourceName: pItem.sourceName || 'PROPRIA', quantity: qty, itemNumbers: itemNum ? [itemNum] : [] });
      }
    }

    for (const agg of aggregatedItems.values()) {
      // Try to find in PROPRIA_${proposalId} first
      let composition = await prisma.engineeringComposition.findFirst({
        where: { code: { equals: agg.code, mode: 'insensitive' }, database: { name: `PROPRIA_${proposalId}` } },
        include: {
          database: true,
          items: {
            include: {
              item: true,
              composition: { include: { database: true } }
            }
          }
        }
      });

      // Try to find in PROPRIA next (overridden composition)
      if (!composition) {
        composition = await prisma.engineeringComposition.findFirst({
          where: { code: { equals: agg.code, mode: 'insensitive' }, database: { name: 'PROPRIA' } },
          include: {
            database: true,
            items: {
              include: {
                item: true,
                composition: { include: { database: true } }
              }
            }
          }
        });
      }

      // Fallback to the one matching the sourceName
      if (!composition) {
          composition = await prisma.engineeringComposition.findFirst({
            where: { code: { equals: agg.code, mode: 'insensitive' }, database: { name: agg.sourceName } },
            include: {
              database: true,
              items: {
                include: {
                  item: true,
                  composition: { include: { database: true } }
                }
              }
            }
          });
      }

      // Final fallback to any
      if (!composition) {
          composition = await prisma.engineeringComposition.findFirst({
            where: { code: { equals: agg.code, mode: 'insensitive' } },
            include: {
              database: true,
              items: {
                include: {
                  item: true,
                  composition: { include: { database: true } }
                }
              }
            }
          });
      }

      if (!composition) continue;

      const flattened = await this.resolveComposition(composition.id, false, composition.database?.name || agg.sourceName);
      if (flattened) {
        flattened.proposalQuantity = agg.quantity;
        
        let divValue = 1;
        if (flattened.metadata) {
          try {
            const meta = typeof flattened.metadata === 'string' ? JSON.parse(flattened.metadata) : flattened.metadata;
            if (meta?.referenceDivisor?.value > 0) {
              divValue = Number(meta.referenceDivisor.value) || 1;
            }
          } catch (err) {
            console.error('[CompositionFlattener] Error parsing metadata for divisor:', err);
          }
        }
        
        flattened.proposalTotal = agg.quantity * (flattened.valorComBdi / divValue);
        flattened.itemNumbers = agg.itemNumbers;
        principalCompositions.push(flattened);
      }
    }

    return {
      principalCompositions,
      auxiliaryCompositions: Array.from(this.visitedAuxiliaries.values())
    };
  }

  /**
   * Recursively resolves a composition and its items.
   */
  private async resolveComposition(compositionId: string, isAuxiliary: boolean, sourceName: string): Promise<FlattenedComposition | null> {
    // If it's an auxiliary and we already processed it, skip re-processing to prevent infinite loops and duplicates
    if (isAuxiliary && this.visitedAuxiliaries.has(compositionId)) {
      return this.visitedAuxiliaries.get(compositionId)!;
    }

    const composition = await prisma.engineeringComposition.findUnique({
      where: { id: compositionId },
      include: {
        database: true,
        items: {
          include: {
            item: {
              include: {
                database: true
              }
            },
          }
        }
      }
    });

    if (!composition) return null;

    const metadataObj = composition.metadata 
      ? (typeof composition.metadata === 'string' 
          ? JSON.parse(composition.metadata) 
          : composition.metadata)
      : null;
    const officialRef = (metadataObj && typeof metadataObj === 'object') ? metadataObj._officialRef : null;

    const dbName = composition.database?.name || sourceName;
    const isPropriaDb = dbName === 'PROPRIA' || dbName.startsWith('PROPRIA_');

    let displayCode = composition.code;
    let displaySourceName = dbName;

    if (isPropriaDb) {
      if (officialRef && typeof officialRef === 'object') {
        displayCode = officialRef.originalCode || officialRef.code || composition.code;
        displaySourceName = officialRef.databaseName || officialRef.sourceName || 'PROPRIA';
      } else {
        displaySourceName = 'PROPRIA';
      }
    }

    const flattenedItems: FlattenedItem[] = [];
    let totalMoComLs = 0;
    let totalMaterial = 0;
    let totalEquipamento = 0;

    for (const ci of composition.items) {
      if (ci.itemId && ci.item) {
        const itemDbName = ci.item.database?.name || composition.database?.name || sourceName;
        const displayItemSourceName = itemDbName.startsWith('PROPRIA') ? 'PROPRIA' : itemDbName;

        // It's a basic item (Material, Labor, Equipment)
        let unitPrice = ci.item.price;
        let itemTotal = ci.item.price * ci.coefficient;

        if (isPropriaDb && ci.price !== undefined && ci.coefficient > 0) {
          unitPrice = ci.price / ci.coefficient;
          itemTotal = ci.price;
        }

        flattenedItems.push({
          type: ci.item.type,
          code: ci.item.code,
          sourceName: displayItemSourceName,
          description: ci.item.description,
          unit: ci.item.unit,
          coefficient: ci.coefficient,
          unitPrice: unitPrice,
          totalPrice: itemTotal,
          coefficientExpression: ci.coefficientExpression || null,
          groupKey: ci.groupKey || null,
        });

        // Accumulate totals for the footer
        if (ci.item.type === 'MAO_DE_OBRA') totalMoComLs += itemTotal;
        else if (ci.item.type === 'MATERIAL') totalMaterial += itemTotal;
        else if (ci.item.type === 'EQUIPAMENTO') totalEquipamento += itemTotal;
        
      } else if (ci.auxiliaryCompositionId) {
        // It's an auxiliary composition, we need to resolve it recursively
        const auxComp = await prisma.engineeringComposition.findUnique({
          where: { id: ci.auxiliaryCompositionId },
          include: { database: true }
        });

        if (auxComp) {
          const auxSourceName = auxComp.database?.name || sourceName;
          const auxMetadataObj = auxComp.metadata 
            ? (typeof auxComp.metadata === 'string' 
                ? JSON.parse(auxComp.metadata) 
                : auxComp.metadata)
            : null;
          const auxOfficialRef = (auxMetadataObj && typeof auxMetadataObj === 'object') ? auxMetadataObj._officialRef : null;

          let displayAuxCode = auxComp.code;
          let displayAuxSourceName = auxSourceName;

          if (displayAuxSourceName === 'PROPRIA' || displayAuxSourceName.startsWith('PROPRIA_')) {
            if (auxOfficialRef && typeof auxOfficialRef === 'object') {
              displayAuxCode = auxOfficialRef.originalCode || auxOfficialRef.code || auxComp.code;
              displayAuxSourceName = auxOfficialRef.databaseName || auxOfficialRef.sourceName || 'PROPRIA';
            } else {
              displayAuxSourceName = 'PROPRIA';
            }
          }
          
          let unitPrice = auxComp.totalPrice;
          let itemTotal = auxComp.totalPrice * ci.coefficient;

          if (isPropriaDb && ci.price !== undefined && ci.coefficient > 0) {
            unitPrice = ci.price / ci.coefficient;
            itemTotal = ci.price;
          }

          flattenedItems.push({
            type: 'COMPOSICAO_AUXILIAR',
            code: displayAuxCode,
            sourceName: displayAuxSourceName,
            description: auxComp.description,
            unit: auxComp.unit,
            coefficient: ci.coefficient,
            unitPrice: unitPrice, // Unit price of the composition
            totalPrice: itemTotal,
            coefficientExpression: ci.coefficientExpression || null,
            groupKey: ci.groupKey || null,
          });

          // Recursively resolve and store the auxiliary composition
          const auxFlattened = await this.resolveComposition(ci.auxiliaryCompositionId, true, auxSourceName);
          if (auxFlattened) {
             const scale = auxComp.totalPrice > 0 ? (unitPrice / auxComp.totalPrice) : 1;
             totalMoComLs += auxFlattened.totalMoComLs * ci.coefficient * scale;
             totalMaterial += auxFlattened.totalMaterial * ci.coefficient * scale;
             totalEquipamento += auxFlattened.totalEquipamento * ci.coefficient * scale;
          }
        }
      }
    }

    // Leis Sociais already included in totalMoComLs. Extract backward.
    const totalMoSemLs = totalMoComLs / (1 + this.lsPercentage);
    const totalLs = totalMoComLs - totalMoSemLs;
    
    const valorBdi = composition.totalPrice * this.bdi;
    const valorComBdi = composition.totalPrice + valorBdi;

    const result: FlattenedComposition = {
      id: composition.id,
      code: displayCode,
      sourceName: displaySourceName,
      description: composition.description,
      unit: composition.unit,
      totalPrice: composition.totalPrice,
      items: flattenedItems,
      isAuxiliary,
      itemNumbers: [], // populated by flattenProposal for principals
      metadata: composition.metadata,
      totalMoSemLs,
      totalLs,
      totalMoComLs,
      totalMaterial,
      totalEquipamento,
      valorBdi,
      valorComBdi,
      proposalQuantity: 0,
      proposalTotal: 0,
    };

    if (isAuxiliary) {
      this.visitedAuxiliaries.set(compositionId, result);
    }

    return result;
  }
}
