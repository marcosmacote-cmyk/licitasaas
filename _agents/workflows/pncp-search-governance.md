# 🔒 PNCP Search Module — Governance & Anti-Regression Guide
# Version: 2.0-stable | Tag: pncp-filters-v2.0-stable | Build: b7f8bf8
# Last verified: 2026-04-17 23:38 BRT

> **⚠️ CRITICAL**: This module is PRODUCTION-STABLE. Any modification MUST respect
> the architecture and contracts documented below. Regressions on filters will
> directly impact paying customers.

---

## 📁 File Map

| File | Role |
|------|------|
| `server/routes/pncp.ts` | Backend: API calls, local filtering, hydration |
| `src/components/hooks/usePncpSearch.ts` | Frontend: search state, pagination cache, API calls |
| `src/components/hooks/usePncpPage.ts` | Frontend: filter constants (STATUS_OPTIONS, MODALIDADES, ESFERAS) |
| `src/components/pncp/PncpSearchFilters.tsx` | Frontend: filter UI components |
| `src/components/pncp/PncpResultsTable.tsx` | Frontend: results table + rotating loader |

---

## 🏗️ Architecture: "API + Local Enforcement"

The Gov.br PNCP API (`/api/search/`) is an Elasticsearch endpoint that:
- ✅ RELIABLY supports: `status` (only `recebendo_proposta` / `encerradas`), `ufs`, `q` (full-text)
- ❌ IGNORES completely: `modalidades_licitacao`, `status=suspensas`, `status=anuladas`
- ❌ LEAKS on: `NOT` operator in `q`, orgao names in `q` (matches against description text)

### The Golden Rule
> **Every filter MUST have local enforcement on the server.** The API is used to
> NARROW the dataset, but the server's local filter chain is the ONLY authority.

### Pipeline Flow (search-hybrid endpoint)

```
[Frontend] → POST /api/pncp/search-hybrid
    ↓
[1. API Query Construction]
    - Keywords → q param (OR syntax)
    - Orgao → q param ONLY when keywords are empty
    - Status → API param (only recebendo_proposta/encerradas)
    - UF → API param
    - Everything else → NOT sent to API
    ↓
[2. API Fetch] → Gov.br /api/search/ (100 items per page)
    ↓
[3. Item Mapping] → Normalize field names to frontend format
    ↓
[4. LOCAL FILTER CHAIN] (order matters!)
    ├── 4a. Esfera filter
    ├── 4b. Modalidade filter (by name matching)
    ├── 4c. Date range filter (by data_encerramento_proposta)
    ├── 4d. Orgao filter (strict: orgao_nome, municipio, CNPJ)
    └── 4e. Exclude keywords filter (accent-normalized)
    ↓
[5. HYDRATION] → Fetch missing valor_estimado (local DB → API → items sum)
    ↓
[6. VALUE RANGE FILTER] ← MUST be after hydration!
    ↓
[7. SORTING] → By deadline (ascending for open, descending for closed)
    ↓
[8. Response] → { items, total (filtered count when local filters active) }
```

---

## 🔐 Filter Contracts (10 Filters)

### Tier 1: API-Native Filters
| # | Filter | API Param | Local Backup | Notes |
|---|--------|-----------|--------------|-------|
| 1 | **Palavras-chave** | `q` (OR quoted) | — | Comma-separated → OR |
| 2 | **Status (Abertas/Encerradas)** | `status` | — | Only these two work |
| 3 | **UF** | `ufs` | — | Supports comma-separated regions |

### Tier 2: Locally-Enforced Filters
| # | Filter | API Param | Local Enforcement | Notes |
|---|--------|-----------|-------------------|-------|
| 4 | **Status (Suspensas/Anuladas)** | ❌ Skips API entirely | Falls back to PncpSearchV3 (local DB) | `canUseOfficialApi = false` |
| 5 | **Modalidade** | ❌ Ignored by API | Name-based matching (pregão, dispensa, etc.) | Uses `MODALIDADE_NAMES` map |
| 6 | **Esfera** | ❌ Ignored by API | ID-based matching | Uses `esferaMap` |
| 7 | **Órgão** | `q` only when no keywords | Strict: `orgao_nome`, `municipio`, `orgao_cnpj` | Prevents false positives from description matches |
| 8 | **Excluir Palavras-chave** | ❌ NOT removed from API | Accent-normalized `.includes()` check on `objeto + titulo` | Uses Unicode NFD normalization |
| 9 | **Prazo Limite (Datas)** | ❌ Ignored by API | Checks `data_encerramento_proposta` or `data_abertura` | Labels: "Prazo Limite Inicial/Final" |
| 10 | **Valor Mín/Máx** | ❌ Not supported | Applied AFTER hydration | Items with valor=0 (unknown) pass through |

---

## 🚨 Anti-Regression Rules

### RULE 1: Never Trust the API Alone
```
❌ WRONG: Send modalidade to API and trust the results
✅ RIGHT: Send to API (optional) AND enforce locally
```

### RULE 2: Value Filter Must Be After Hydration
```
❌ WRONG: Filter by valor → Hydrate → Display (items arrive with valor=0, pass filter, get real values)
✅ RIGHT: Hydrate → Filter by valor → Display
```

### RULE 3: Orgao Names in q Param Are Conditional
```
❌ WRONG: Always include orgao in q with AND (restricts keyword results)
❌ WRONG: Never include orgao in q (returns random items when no keywords)
✅ RIGHT: Include orgao in q ONLY when keywords field is empty
```

### RULE 4: Exclude Keywords Must Use Accent Normalization
```
❌ WRONG: text.toLowerCase().includes(keyword.toLowerCase())
✅ RIGHT: normalize(text).includes(normalize(keyword))
   where normalize = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
```

### RULE 5: effectiveTotal Must Reflect Local Filtering
```
❌ WRONG: total = API's totalRegistros (doesn't account for locally-removed items)
✅ RIGHT: total = hasLocalFilters ? finalItems.length : totalRegistros
```

### RULE 6: Pagination Must Use Independent API Page Counter
```
❌ WRONG: apiPage = Math.floor(cache.length / API_PAGE_SIZE) + 1 (skips pages when local filters reduce cache)
✅ RIGHT: apiPageRef.current += 1 (independent counter, always increments by 1)
```

### RULE 7: Status Routing
```
if (status === 'suspensa' || status === 'anulada') → Local DB (PncpSearchV3)
if (status === 'recebendo_proposta' || status === 'encerrada') → Gov.br API
if (status === 'todas') → Gov.br API (no status param)
```

---

## 🧪 Test Scenarios (Manual QA Checklist)

Before deploying changes to this module, verify ALL of these:

- [ ] **Keywords**: "Eventos, veículos" → Results contain EITHER term in objeto
- [ ] **Exclude Keywords**: "ambulância" → NO results with "ambulancia" or "ambulância" in objeto
- [ ] **Modalidade**: "Pregão Eletrônico" → ONLY Pregão items shown
- [ ] **Status Abertas**: Only items with future deadlines
- [ ] **Status Anuladas**: Falls back to local DB, returns anulada items
- [ ] **Órgão (single)**: "Limoeiro" → Only Limoeiro items
- [ ] **Órgão (multiple)**: "Limoeiro, Russas" → Items from BOTH municipalities
- [ ] **Keywords + Órgão**: "Eventos" + "Limoeiro, Russas" → Eventos from Limoeiro OR Russas only
- [ ] **Prazo Limite**: Set date range → Only items within range
- [ ] **Valor Mín/Máx**: Set 50000-500000 → No items below 50k or above 500k
- [ ] **Pagination**: Page 1-6 instant, page 7+ triggers ONE API call, then instant again
- [ ] **10 items per page**: Every page shows exactly 10 items (except last)
- [ ] **Combinação total**: Keywords + Modalidade + Órgão + Excluir + Valor → All filters respected simultaneously

---

## 📊 Performance Benchmarks

| Metric | Target | Current |
|--------|--------|---------|
| Initial search latency | < 8s | ~5-7s |
| Page change (cached) | < 100ms | ~50ms |
| Page change (new API chunk) | < 5s | ~3-5s |
| Items per API chunk | 100 | 100 |
| Items per display page | 10 | 10 |

---

## 🔄 Recovery Procedure

If a deployment breaks filters:
```bash
# Rollback to the last verified stable tag
git checkout pncp-filters-v2.0-stable
git push origin main --force
```

---

## 📝 Commit Trail (for reference)

```
b7f8bf8 fix(pncp): send orgao names to API when no keywords specified
6291ce3 fix(pncp): move value range filter AFTER hydration
9182b27 fix(pncp): remove broken NOT from API query + accent normalization
fac41b6 fix(pncp): add local enforcement for excludeKeywords and valor
b12d002 fix(pncp): decouple orgao from API q param
c704c50 fix(pncp): comprehensive filter overhaul — all filtering local
78b4ef7 fix(pncp): strict local orgao filter + decouple api page counter
086bdd0 fix(pncp): comma-separated orgao + deadline date filtering
d008db3 fix(pncp): stop rotating loading phrase at final message
f1eb00e feat(pncp): rotating loading phrases during search
5656263 feat(pncp): smart caching + deadline sorting + premium icons
aab4ddb feat(pncp): hydrate global value using items sum
```
