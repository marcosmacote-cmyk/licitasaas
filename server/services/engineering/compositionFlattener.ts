import { EngineeringComposition, EngineeringCompositionItem, EngineeringItem } from '@prisma/client';
import prisma from '../../lib/prisma';
import { resolveDisplayBase, deriveGroupKey } from './baseResolver';
import { classifyInsumoType } from './insumoClassifier';

function safeParseJson(val: any): any {
  if (!val) return null;
  if (typeof val === 'object') return val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  return null;
}

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

    // G8-FIX: Batch-load ALL compositions in a single query instead of N+1
    const allCodes = [...aggregatedItems.keys()];
    const allCompositions = allCodes.length > 0 ? await prisma.engineeringComposition.findMany({
      where: { code: { in: allCodes, mode: 'insensitive' } },
      include: {
        database: true,
        items: {
          include: {
            item: true,
            composition: { include: { database: true } }
          }
        }
      }
    }) : [];

    // Build priority map: PROPRIA_proposalId > PROPRIA > sourceName > any
    const compByCode = new Map<string, any>();
    // Pass 1: any database (lowest priority)
    for (const c of allCompositions) compByCode.set(c.code.toUpperCase(), c);
    // Pass 2: matching sourceName
    for (const agg of aggregatedItems.values()) {
      const sourceMatch = allCompositions.find(c => 
        c.code.toUpperCase() === agg.code.toUpperCase() && c.database?.name === agg.sourceName
      );
      if (sourceMatch) compByCode.set(sourceMatch.code.toUpperCase(), sourceMatch);
    }
    // Pass 3: PROPRIA (override)
    for (const c of allCompositions) {
      if (c.database?.name === 'PROPRIA') compByCode.set(c.code.toUpperCase(), c);
    }
    // Pass 4: PROPRIA_proposalId (highest priority)
    for (const c of allCompositions) {
      if (c.database?.name === `PROPRIA_${proposalId}`) compByCode.set(c.code.toUpperCase(), c);
    }

    for (const agg of aggregatedItems.values()) {
      const composition = compByCode.get(agg.code.toUpperCase());
      const matchingItems = proposalItems.filter((p: any) => p.code?.toUpperCase() === agg.code.toUpperCase());
      const isExplicitInsumo = matchingItems.some((p: any) => p.type === 'INSUMO');

      if (!composition || isExplicitInsumo) {
        if (matchingItems.length > 0) {
          const matchedItem = matchingItems[0];
          const totalP = matchingItems.reduce((s: number, it: any) => s + (it.totalPrice || 0), 0);
          
          const insumoClassification = classifyInsumoType(matchedItem.description || '', matchedItem.unit || 'UN');
          const isMaoDeObra = insumoClassification.type === 'MAO_DE_OBRA';
          
          const totalMoComLs = isMaoDeObra ? (matchedItem.unitCost || 0) : 0;
          const totalMoSemLs = isMaoDeObra ? (totalMoComLs / (1 + this.lsPercentage)) : 0;
          const totalLs = totalMoComLs - totalMoSemLs;
          
          const totalMaterial = insumoClassification.type === 'MATERIAL' ? (matchedItem.unitCost || 0) : 0;
          const totalEquipamento = insumoClassification.type === 'EQUIPAMENTO' ? (matchedItem.unitCost || 0) : 0;

          principalCompositions.push({
            id: matchedItem.id,
            code: agg.code,
            sourceName: agg.sourceName,
            description: matchedItem.description || '',
            unit: matchedItem.unit || 'UN',
            totalPrice: matchedItem.unitCost || 0,
            items: [],
            isAuxiliary: false,
            itemNumbers: agg.itemNumbers,
            metadata: { _isDirectInsumo: true },
            totalMoSemLs,
            totalLs,
            totalMoComLs,
            totalMaterial,
            totalEquipamento,
            valorBdi: (matchedItem.unitPrice || 0) - (matchedItem.unitCost || 0),
            valorComBdi: matchedItem.unitPrice || 0,
            proposalQuantity: agg.quantity,
            proposalTotal: totalP,
          });
        }
        continue;
      }

      const flattened = await this.resolveComposition(composition.id, false, composition.database?.name || agg.sourceName);
      if (flattened) {
        flattened.proposalQuantity = agg.quantity;
        
        let divValue = 1;
        if (flattened.metadata) {
          const meta = safeParseJson(flattened.metadata);
          if (meta?.referenceDivisor?.value > 0) {
            divValue = Number(meta.referenceDivisor.value) || 1;
          }
        }
        
        // Sum total prices of matching proposal items to avoid float and rounding divergences
        const totalP = matchingItems.reduce((s: number, it: any) => s + (it.totalPrice || 0), 0);
        flattened.proposalTotal = totalP;

        // Align the composition's displayed header prices with the first matching budget item
        if (matchingItems.length > 0) {
          const matchedItem = matchingItems[0];
          if (matchedItem.unitPrice !== undefined && matchedItem.unitPrice !== null) {
            flattened.valorComBdi = matchedItem.unitPrice;
            flattened.valorBdi = matchedItem.unitPrice - (matchedItem.unitCost || 0);
            flattened.totalPrice = matchedItem.unitCost || 0;
          }
        }
        
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

    const metadataObj = safeParseJson(composition.metadata);
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
        // FIX BUG-1: Use resolveDisplayBase to show the real official base (SEINFRA/SINAPI)
        // instead of generic 'PROPRIA' when items are stored in a PROPRIA database.
        const displayItemSourceName = resolveDisplayBase(itemDbName, undefined, ci.item.code);

        // It's a basic item (Material, Labor, Equipment)
        let unitPrice = ci.item.price;
        let itemTotal = ci.item.price * ci.coefficient;

        if (isPropriaDb && ci.price !== undefined && ci.coefficient > 0) {
          unitPrice = ci.price / ci.coefficient;
          itemTotal = ci.price;
        }

        // Classify type with fallback for items still marked as default MATERIAL
        const resolvedType = ci.item.type === 'MATERIAL'
          ? classifyInsumoType(ci.item.description, ci.item.unit, ci.item.type).type
          : ci.item.type;

        flattenedItems.push({
          type: resolvedType,
          code: ci.item.code,
          sourceName: displayItemSourceName,
          description: ci.item.description,
          unit: ci.item.unit,
          coefficient: ci.coefficient,
          unitPrice: unitPrice,
          totalPrice: itemTotal,
          coefficientExpression: ci.coefficientExpression || null,
          // FIX BUG-2: Derive groupKey from item type when not persisted
          groupKey: deriveGroupKey(ci.item.type, ci.groupKey),
        });

        // G4-FIX: Use resolvedType (from classifier) instead of ci.item.type (raw DB)
        // to ensure footer totals match the badges shown in the report
        if (resolvedType === 'MAO_DE_OBRA') totalMoComLs += itemTotal;
        else if (resolvedType === 'MATERIAL') totalMaterial += itemTotal;
        else if (resolvedType === 'EQUIPAMENTO') totalEquipamento += itemTotal;
        
      } else if (ci.auxiliaryCompositionId) {
        // It's an auxiliary composition, we need to resolve it recursively
        const auxComp = await prisma.engineeringComposition.findUnique({
          where: { id: ci.auxiliaryCompositionId },
          include: { database: true }
        });

        if (auxComp) {
          const auxSourceName = auxComp.database?.name || sourceName;
          const auxMetadataObj = safeParseJson(auxComp.metadata);
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
            // FIX BUG-2: Derive groupKey for auxiliary compositions
            groupKey: deriveGroupKey('COMPOSICAO_AUXILIAR', ci.groupKey),
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

    // G3-FIX: Integrity check — compare calculated sum vs stored totalPrice
    const calculatedTotal = flattenedItems.reduce((sum, item) => sum + item.totalPrice, 0);
    const storedTotal = composition.totalPrice;
    if (Math.abs(calculatedTotal - storedTotal) > 0.1 && flattenedItems.length > 0) {
      console.warn(`[CompositionFlattener] ⚠️ Price integrity warning for ${composition.code}: calculated=${calculatedTotal.toFixed(2)} stored=${storedTotal.toFixed(2)} Δ=${(calculatedTotal - storedTotal).toFixed(2)}`);
    }
    // Use calculated total when available (more accurate), fall back to stored
    const effectiveTotal = flattenedItems.length > 0 ? calculatedTotal : storedTotal;

    // Leis Sociais already included in totalMoComLs. Extract backward.
    const totalMoSemLs = totalMoComLs / (1 + this.lsPercentage);
    const totalLs = totalMoComLs - totalMoSemLs;
    
    const valorBdi = effectiveTotal * this.bdi;
    const valorComBdi = effectiveTotal + valorBdi;

    const result: FlattenedComposition = {
      id: composition.id,
      code: displayCode,
      sourceName: displaySourceName,
      description: composition.description,
      unit: composition.unit,
      totalPrice: effectiveTotal,
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
