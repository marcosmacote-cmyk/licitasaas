import { prisma } from './prisma';

export interface PlanLimit {
  maxUsers: number;
  maxCompanies: number;
  maxBiddings: number;
  defaultAiQuotaHard: number;
  defaultAiQuotaSoft: number;
}

export const PLAN_LIMITS: Record<string, PlanLimit> = {
  BASIC: {
    maxUsers: 2,
    maxCompanies: 1,
    maxBiddings: 3,
    defaultAiQuotaHard: 10_000_000,
    defaultAiQuotaSoft: 7_500_000,
  },
  PRO: {
    maxUsers: 10,
    maxCompanies: 5,
    maxBiddings: 20,
    defaultAiQuotaHard: 30_000_000,
    defaultAiQuotaSoft: 22_500_000,
  },
  ENTERPRISE: {
    maxUsers: 9999,
    maxCompanies: 9999,
    maxBiddings: 9999,
    defaultAiQuotaHard: 100_000_000,
    defaultAiQuotaSoft: 75_000_000,
  }
};

export async function checkTenantLimits(
  tenantId: string,
  resourceType: 'users' | 'companies' | 'biddings'
): Promise<{ allowed: boolean; current: number; limit: number; message?: string }> {
  // 1. Get Tenant details
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { plan: true, planStatus: true, planExpiresAt: true }
  });

  if (!tenant) {
    return { allowed: false, current: 0, limit: 0, message: 'Organização não encontrada.' };
  }

  // 2. Check if suspended or expired
  if (tenant.planStatus === 'SUSPENDED') {
    return { allowed: false, current: 0, limit: 0, message: 'Sua assinatura está suspensa. Entre em contato com o suporte.' };
  }

  if (tenant.planExpiresAt && new Date(tenant.planExpiresAt) < new Date()) {
    return { allowed: false, current: 0, limit: 0, message: 'Sua assinatura expirou. Regularize seus pagamentos.' };
  }

  // 3. Get limit config
  const planName = (tenant.plan || 'BASIC').toUpperCase();
  const limits = PLAN_LIMITS[planName] || PLAN_LIMITS.BASIC;

  let currentCount = 0;
  let limitValue = 0;

  if (resourceType === 'users') {
    currentCount = await prisma.user.count({ where: { tenantId } });
    limitValue = limits.maxUsers;
  } else if (resourceType === 'companies') {
    currentCount = await prisma.companyProfile.count({ where: { tenantId } });
    limitValue = limits.maxCompanies;
  } else if (resourceType === 'biddings') {
    currentCount = await prisma.biddingProcess.count({ where: { tenantId } });
    limitValue = limits.maxBiddings;
  }

  if (currentCount >= limitValue) {
    const resourceLabels = {
      users: 'usuários',
      companies: 'perfis de empresa',
      biddings: 'licitações'
    };
    return {
      allowed: false,
      current: currentCount,
      limit: limitValue,
      message: `Limite do plano atingido: seu plano atual (${planName}) permite no máximo ${limitValue} ${resourceLabels[resourceType]}.`
    };
  }

  return { allowed: true, current: currentCount, limit: limitValue };
}

export async function isTenantSuspended(tenantId: string): Promise<boolean> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { planStatus: true, planExpiresAt: true }
  });
  if (!tenant) return true;
  if (tenant.planStatus === 'SUSPENDED') return true;
  if (tenant.planExpiresAt && new Date(tenant.planExpiresAt) < new Date()) return true;
  return false;
}
