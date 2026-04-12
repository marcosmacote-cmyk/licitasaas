import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface CreateAuditLogParams {
  tenantId: string;
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldValue?: any;
  newValue?: any;
  ipAddress?: string;
}

export class AuditLogService {
  /**
   * Registra uma ação sensível no Audit Log (Sprint 5)
   */
  static async log(params: CreateAuditLogParams) {
    try {
      return await prisma.auditLog.create({
        data: {
          tenantId: params.tenantId,
          userId: params.userId,
          action: params.action,
          entityType: params.entityType,
          entityId: params.entityId,
          oldValue: params.oldValue,
          newValue: params.newValue,
          ipAddress: params.ipAddress,
        },
      });
    } catch (error) {
      console.error('[AuditLog] Falha ao registrar log:', error);
      // Fail silently to avoid breaking the main business flow
    }
  }

  /**
   * Retorna o histórico de auditoria para um tenant
   */
  static async getLogs(tenantId: string, limit = 100, offset = 0) {
    const logs = await prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        user: { select: { id: true, name: true, email: true } }
      }
    });

    const total = await prisma.auditLog.count({ where: { tenantId } });

    return { logs, total };
  }
}
