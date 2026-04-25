import { PrismaClient, EngineeringComposition, EngineeringCompositionItem, EngineeringItem } from '@prisma/client';

const prisma = new PrismaClient();

export interface FlattenedItem {
  type: string; // 'MATERIAL', 'MAO_DE_OBRA', 'EQUIPAMENTO', 'COMPOSICAO_AUXILIAR'
  code: string;
  sourceName: string;
  description: string;
  unit: string;
  coefficient: number;
  unitPrice: number;
  totalPrice: number;
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
  private lsPercentage: number; // e.g., 0.8464 for 84.64%

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

    // Aggregate quantities by code
    const aggregatedItems = new Map<string, { code: string, sourceName: string, quantity: number }>();
    for (const pItem of proposalItems) {
      if (!pItem.code || pItem.code === 'N/A') continue;
      const codeStr = pItem.code.toUpperCase();
      const qty = typeof pItem.quantity === 'number' ? pItem.quantity : 1;
      
      if (aggregatedItems.has(codeStr)) {
        aggregatedItems.get(codeStr)!.quantity += qty;
      } else {
        aggregatedItems.set(codeStr, { code: pItem.code, sourceName: pItem.sourceName || 'PROPRIA', quantity: qty });
      }
    }

    for (const agg of aggregatedItems.values()) {
      // Try to find in PROPRIA first (overridden composition)
      let composition = await prisma.engineeringComposition.findFirst({
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
        flattened.proposalTotal = agg.quantity * flattened.valorComBdi;
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
            item: true,
          }
        }
      }
    });

    if (!composition) return null;

    const flattenedItems: FlattenedItem[] = [];
    let totalMoComLs = 0;
    let totalMaterial = 0;
    let totalEquipamento = 0;

    for (const ci of composition.items) {
      if (ci.itemId && ci.item) {
        // It's a basic item (Material, Labor, Equipment)
        flattenedItems.push({
          type: ci.item.type,
          code: ci.item.code,
          sourceName: composition.database?.name || sourceName,
          description: ci.item.description,
          unit: ci.item.unit,
          coefficient: ci.coefficient,
          unitPrice: ci.item.price,
          totalPrice: ci.item.price * ci.coefficient,
        });

        // Accumulate totals for the footer (in SINAPI/SEINFRA, unit price already includes LS!)
        const itemTotal = ci.item.price * ci.coefficient;
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
          
          flattenedItems.push({
            type: 'COMPOSICAO_AUXILIAR',
            code: auxComp.code,
            sourceName: auxSourceName,
            description: auxComp.description,
            unit: auxComp.unit,
            coefficient: ci.coefficient,
            unitPrice: auxComp.totalPrice, // Unit price of the composition
            totalPrice: auxComp.totalPrice * ci.coefficient,
          });

          // Recursively resolve and store the auxiliary composition
          const auxFlattened = await this.resolveComposition(ci.auxiliaryCompositionId, true, auxSourceName);
          if (auxFlattened) {
             totalMoComLs += auxFlattened.totalMoComLs * ci.coefficient;
             totalMaterial += auxFlattened.totalMaterial * ci.coefficient;
             totalEquipamento += auxFlattened.totalEquipamento * ci.coefficient;
          }
        }
      }
    }

    // Leis Sociais already included in totalMoComLs. Extract backward.
    const totalMoSemLs = totalMoComLs / (1 + this.lsPercentage);
    const totalLs = totalMoComLs - totalMoSemLs;
    
    // We will stick to the composition's provided totalPrice to respect the official bank, 
    // unless we strictly want dynamic calculation. Let's use the official one for the composition itself.
    
    const valorBdi = composition.totalPrice * this.bdi;
    const valorComBdi = composition.totalPrice + valorBdi;

    const result: FlattenedComposition = {
      id: composition.id,
      code: composition.code,
      sourceName: composition.database?.name || sourceName,
      description: composition.description,
      unit: composition.unit,
      totalPrice: composition.totalPrice,
      items: flattenedItems,
      isAuxiliary,
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
