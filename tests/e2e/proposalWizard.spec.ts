import { test, expect } from '@playwright/test';

test.describe('LicitaSaaS - Engineering Proposal Wizard E2E Simulation', () => {
    test.beforeEach(async ({ page }) => {
        page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
        page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

        // Previne que o tour de boas-vindas apareça durante os testes E2E
        await page.addInitScript(() => {
            window.localStorage.setItem('tour_welcome_completed', 'true');
        });

        // 1. Mock dos endpoints de suporte para o carregamento limpo do app
        await page.route('**/api/companies', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: [{ id: 'comp-1', razaoSocial: 'Empresa Teste E2E', cnpj: '12.345.678/0001-99' }]
            });
        });

        await page.route('**/api/biddings', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: [{
                    id: 'bid-1',
                    title: 'Construção da Praça Central',
                    processNumber: '001/2026',
                    portal: 'ComprasNet',
                    status: 'Preparando Proposta',
                    estimatedValue: 1500000.00,
                    modality: 'Pregão Eletrônico',
                    processYear: '2026'
                }]
            });
        });

        await page.route('**/api/engineering/bases', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: [
                    { id: 'db-sinapi', name: 'SINAPI', uf: 'SP', type: 'OFICIAL' },
                    { id: 'db-seinfra', name: 'SEINFRA', uf: 'CE', type: 'OFICIAL' }
                ]
            });
        });

        // Mock das APIs secundárias do App.tsx para evitar erros de conexão no console do WebServer
        await page.route('**/api/chat-monitor/**', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', json: { count: 0, logs: [] } });
        });
        await page.route('**/api/pncp/**', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', json: { count: 0, opportunities: [] } });
        });
        await page.route('**/api/analyze-edital/**', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', json: [] });
        });
        await page.route('**/api/admin/**', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', json: [] });
        });
        await page.route('**/api/documents/**', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', json: [] });
        });

        // Mock do relatório de reconciliação de preços
        await page.route('**/api/engineering/proposals/*/reconciliation-report', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: {
                    summary: { totalAlerts: 0 },
                    alerts: []
                }
            });
        });

        // Mock do hub de resolução de insumos
        await page.route('**/api/engineering/insumos-hub-resolve', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: {
                    insumos: []
                }
            });
        });

        // Mock de criação de composição própria (se aplicável)
        await page.route('**/api/engineering/propria/create', async (route) => {
            const req = route.request();
            const postData = req.postData() || '{}';
            console.log(`[E2E ROUTE LOG] POST /api/engineering/propria/create Payload:`, postData);
            const body = JSON.parse(postData);
            const priceVal = typeof body.price === 'number' ? body.price : parseFloat(body.price) || 10.00;
            const responsePayload = {
                success: true,
                item: {
                    id: 'propria-new',
                    code: body.code || 'PROPRIA-NEW',
                    description: body.description || 'Item Criado',
                    price: priceVal,
                    unit: body.unit || 'UN',
                    recordKind: body.recordKind || 'COMPOSICAO'
                }
            };
            console.log(`[E2E ROUTE LOG] POST /api/engineering/propria/create Response:`, JSON.stringify(responsePayload));
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: responsePayload
            });
        });

        // Mock do carregamento dos itens da proposta de engenharia
        await page.route('**/api/engineering/proposals/prop-1/items*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: {
                    items: [
                        {
                            id: 'item-1',
                            itemNumber: '1',
                            code: '88316',
                            description: 'SERVENTE COM ENCARGOS COMPLEMENTARES',
                            unit: 'H',
                            quantity: 100,
                            unitCost: 18.50,
                            unitPrice: 23.13,
                            totalPrice: 2313.00,
                            bdiCategoria: 'OBRA',
                            type: 'COMPOSICAO',
                            sourceName: 'SINAPI'
                        },
                        {
                            id: 'item-2',
                            itemNumber: '2',
                            code: 'COMP-MAT',
                            description: 'COMPOSICAO DE MATERIAIS DIVERSOS',
                            unit: 'M3',
                            quantity: 50,
                            unitCost: 80.00,
                            unitPrice: 100.00,
                            totalPrice: 5000.00,
                            bdiCategoria: 'OBRA',
                            type: 'COMPOSICAO',
                            sourceName: 'PROPRIA'
                        }
                    ],
                    bdiConfig: {
                        mode: 'TCU',
                        bdiGlobal: 25.00,
                        tcu: {
                            adminCentral: 4.00,
                            seguros: 0.80,
                            garantias: 0.80,
                            riscos: 0.97,
                            despFinanceiras: 0.59,
                            lucro: 6.16,
                            pis: 0.65,
                            cofins: 3.00,
                            iss: 2.00,
                            csll: 0,
                            cprb: 4.50
                        },
                        tcuFornecimento: {
                            adminCentral: 1.50,
                            seguros: 0.30,
                            garantias: 0.30,
                            riscos: 0.80,
                            despFinanceiras: 0.40,
                            lucro: 3.50,
                            pis: 0.65,
                            cofins: 3.00,
                            iss: 2.00,
                            csll: 0,
                            cprb: 0
                        }
                    },
                    engineeringConfig: {
                        UF: 'SP',
                        basesConsideradas: ['SINAPI'],
                        dataBase: '2026-04',
                        regimeOneracao: 'DESONERADO',
                        bdiDiferenciado: false,
                        bdiFornecimento: 15.00,
                        precision: { tipo: 'ROUND', casasDecimais: 2 }
                    }
                }
            });
        });

        await page.route('**/api/proposals/bid-1', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: [{
                    id: 'prop-1',
                    biddingProcessId: 'bid-1',
                    companyProfileId: 'comp-1',
                    version: 1,
                    status: 'DRAFT',
                    bdiPercentage: 25.00,
                    taxPercentage: 0,
                    objectType: 'ENGENHARIA'
                }]
            });
        });

        // Mock para salvar configurações da proposta (PUT /api/engineering/proposals/prop-1)
        await page.route('**/api/engineering/proposals/prop-1', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: { success: true }
            });
        });
    });

    test('Should load proposal configuration in Step 1 and proceed to Step 2', async ({ page }) => {
        // Simula login automático específico para este teste
        await page.addInitScript(() => {
            window.localStorage.setItem('token', 'mock-token-123');
            window.localStorage.setItem('user', JSON.stringify({
                id: 'usr-test',
                name: 'Operador E2E',
                role: 'SUPER_ADMIN',
                tenantId: 'tenant-test',
                tenantName: 'LicitaSaaS E2E'
            }));
        });

        // Abre o painel
        await page.goto('/');

        // Garante que o app carregou
        await expect(page.locator('.sidebar-header').locator('text=LicitaSaaS').first()).toBeVisible({ timeout: 10000 });

        // Clica na navegação de Produção
        const productionBtn = page.locator('a:has-text("Produção")').first();
        await expect(productionBtn).toBeVisible();
        await productionBtn.click();

        // Verifica que o motor de proposta foi inicializado
        await expect(page.locator('text=Elaboração de Proposta de Preços')).toBeVisible({ timeout: 5000 });

        // Seleciona a licitação (a empresa 'comp-1' será auto-selecionada pelo carregamento da proposta)
        const biddingSelect = page.locator('select:has-text("Selecione uma licitação")');
        await biddingSelect.locator('option[value="bid-1"]').waitFor({ state: 'attached', timeout: 5000 });
        await biddingSelect.selectOption('bid-1');

        // Confirma que carregou a Configuração no Passo 1 (Bases de Referência)
        await expect(page.locator('text=Bases de Referência').first()).toBeVisible({ timeout: 5000 });

        // Clica no botão para avançar para o Passo 2
        const nextBtn = page.locator('button:has-text("Próximo: Planilha Orçamentária")');
        await expect(nextBtn).toBeVisible({ timeout: 5000 });
        await nextBtn.click({ force: true });

        // Espera a proposta e itens carregarem e valida que a aba da Planilha Orçamentária está ativa no Passo 2
        await expect(page.locator('.tab-btn.active:has-text("Planilha Orçamentária")').first()).toBeVisible({ timeout: 5000 });
    });

    test('Should show login screen, complete login, navigate to Production, select bidding and load proposal wizard', async ({ page }) => {
        // Mock do endpoint de login para retornar sucesso
        await page.route('**/api/auth/login-v2', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: {
                    token: 'mock-token-123',
                    user: {
                        id: 'usr-test',
                        name: 'Operador E2E',
                        role: 'SUPER_ADMIN',
                        tenantId: 'tenant-test',
                        tenantName: 'LicitaSaaS E2E'
                    }
                }
            });
        });

        // Abre o app diretamente sem localStorage preenchido
        await page.goto('/');

        // Verifica que a tela de login está visível
        await expect(page.locator('text=Gestão Inteligente de Licitações')).toBeVisible({ timeout: 5000 });

        // Preenche as credenciais no form de login
        await page.fill('input[type="email"]', 'admin@licitasaas.com');
        await page.fill('input[type="password"]', 'senha123');

        // Pequena pausa para visualização no modo assistido
        await page.waitForTimeout(500);
        await page.click('button[type="submit"]');

        // Garante que o dashboard carregou após login
        await expect(page.locator('.sidebar-header').locator('text=LicitaSaaS').first()).toBeVisible({ timeout: 10000 });

        // Clica na navegação de Produção
        await page.click('a:has-text("Produção")');

        // Seleciona a licitação (a empresa 'comp-1' será auto-selecionada pelo carregamento da proposta)
        const biddingSelect = page.locator('select:has-text("Selecione uma licitação")');
        await biddingSelect.locator('option[value="bid-1"]').waitFor({ state: 'attached', timeout: 5000 });
        await biddingSelect.selectOption('bid-1');

        // Confirma que carregou a Configuração no Passo 1 (Bases de Referência)
        await expect(page.locator('text=Bases de Referência').first()).toBeVisible({ timeout: 5000 });

        // Clica no botão para avançar para o Passo 2
        const nextBtn = page.locator('button:has-text("Próximo: Planilha Orçamentária")');
        await expect(nextBtn).toBeVisible({ timeout: 5000 });
        await nextBtn.click({ force: true });

        // Confirma que a aba da Planilha Orçamentária foi carregada no Passo 2
        await expect(page.locator('.tab-btn.active:has-text("Planilha Orçamentária")').first()).toBeVisible({ timeout: 5000 });
        await page.waitForTimeout(1000); // Aguarda um momento final para visualização
    });

    test('Should simulate full proposal lifecycle including AI extraction, search official base, add custom composition, save edits, switch versions, adjust proposal value, feed steps 1-5, and export reports', async ({ page }) => {
        let prop1Items = [
            {
                id: 'item-1',
                itemNumber: '1',
                code: '88316',
                description: 'SERVENTE COM ENCARGOS COMPLEMENTARES',
                unit: 'H',
                quantity: 100,
                unitCost: 18.50,
                unitPrice: 23.13,
                totalPrice: 2313.00,
                bdiCategoria: 'OBRA',
                type: 'COMPOSICAO',
                sourceName: 'SINAPI'
            },
            {
                id: 'item-2',
                itemNumber: '2',
                code: 'COMP-MAT',
                description: 'COMPOSICAO DE MATERIAIS DIVERSOS',
                unit: 'M3',
                quantity: 50,
                unitCost: 80.00,
                unitPrice: 100.00,
                totalPrice: 5000.00,
                bdiCategoria: 'OBRA',
                type: 'COMPOSICAO',
                sourceName: 'PROPRIA'
            }
        ];

        let prop0Items = [
            {
                id: 'item-1',
                itemNumber: '1',
                code: '88316',
                description: 'SERVENTE COM ENCARGOS COMPLEMENTARES',
                unit: 'H',
                quantity: 100,
                unitCost: 18.50,
                unitPrice: 23.13,
                totalPrice: 2313.00,
                bdiCategoria: 'OBRA',
                type: 'COMPOSICAO',
                sourceName: 'SINAPI'
            }
        ];

        // Setup initial login localStorage
        await page.addInitScript(() => {
            window.localStorage.setItem('token', 'mock-token-123');
            window.localStorage.setItem('user', JSON.stringify({
                id: 'usr-test',
                name: 'Operador E2E',
                role: 'SUPER_ADMIN',
                tenantId: 'tenant-test',
                tenantName: 'LicitaSaaS E2E'
            }));
        });

        // 1. Mock de suporte adicional para o ciclo completo
        await page.route('**/api/proposals/bid-1', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: [
                    {
                        id: 'prop-1',
                        biddingProcessId: 'bid-1',
                        companyProfileId: 'comp-1',
                        version: 2,
                        status: 'DRAFT',
                        bdiPercentage: 25.00,
                        taxPercentage: 0,
                        objectType: 'ENGENHARIA',
                        createdAt: new Date().toISOString(),
                        totalValue: 7313.00
                    },
                    {
                        id: 'prop-0',
                        biddingProcessId: 'bid-1',
                        companyProfileId: 'comp-1',
                        version: 1,
                        status: 'DRAFT',
                        bdiPercentage: 25.00,
                        taxPercentage: 0,
                        objectType: 'ENGENHARIA',
                        createdAt: new Date(Date.now() - 86400000).toISOString(),
                        totalValue: 2313.00
                    }
                ]
            });
        });

        await page.route('**/api/biddings/bid-1', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: {
                    id: 'bid-1',
                    title: 'Construção da Praça Central',
                    processNumber: '001/2026',
                    portal: 'ComprasNet',
                    status: 'Preparando Proposta',
                    estimatedValue: 1500000.00,
                    modality: 'Pregão Eletrônico',
                    processYear: '2026'
                }
            });
        });

        await page.route('**/api/proposals/detail/prop-1', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: {
                    id: 'prop-1',
                    biddingProcessId: 'bid-1',
                    companyProfileId: 'comp-1',
                    version: 2,
                    status: 'DRAFT',
                    bdiPercentage: 25.00,
                    taxPercentage: 0,
                    objectType: 'ENGENHARIA',
                    company: {
                        id: 'comp-1',
                        razaoSocial: 'Empresa Teste E2E',
                        cnpj: '12.345.678/0001-99',
                        contactName: 'Diretor Comercial',
                        contactCpf: '111.222.333-44',
                        contactCargo: 'Procurador'
                    }
                }
            });
        });

        await page.route('**/api/proposals/detail/prop-0', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: {
                    id: 'prop-0',
                    biddingProcessId: 'bid-1',
                    companyProfileId: 'comp-1',
                    version: 1,
                    status: 'DRAFT',
                    bdiPercentage: 25.00,
                    taxPercentage: 0,
                    objectType: 'ENGENHARIA',
                    company: {
                        id: 'comp-1',
                        razaoSocial: 'Empresa Teste E2E',
                        cnpj: '12.345.678/0001-99',
                        contactName: 'Diretor Comercial',
                        contactCpf: '111.222.333-44',
                        contactCargo: 'Procurador'
                    }
                }
            });
        });

        // Mock das planilhas para prop-1 e prop-0
        await page.route('**/api/engineering/proposals/*/items*', async (route) => {
            const url = route.request().url();
            const method = route.request().method();
            console.log(`[E2E ROUTE LOG] ${method} ${url}`);
            
            if (method === 'POST') {
                const postData = route.request().postData() || '{}';
                console.log(`[E2E ROUTE LOG] POST Payload:`, postData);
                const body = JSON.parse(postData);
                if (url.includes('prop-1')) {
                    if (body.items) prop1Items = body.items;
                } else if (url.includes('prop-0')) {
                    if (body.items) prop0Items = body.items;
                }
                const responsePayload = { success: true, message: 'Planilha salva com sucesso', items: url.includes('prop-1') ? prop1Items : prop0Items };
                console.log(`[E2E ROUTE LOG] POST Response:`, JSON.stringify(responsePayload));
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    json: responsePayload
                });
                return;
            }

            const responseGetPayload = {
                items: url.includes('prop-0') ? prop0Items : prop1Items,
                bdiConfig: {
                    mode: 'TCU',
                    bdiGlobal: 25.00,
                    tcu: {
                        adminCentral: 4.00,
                        seguros: 0.80,
                        garantias: 0.80,
                        riscos: 0.97,
                        despFinanceiras: 0.59,
                        lucro: 6.16,
                        pis: 0.65,
                        cofins: 3.00,
                        iss: 2.00,
                        csll: 0,
                        cprb: 4.50
                    },
                    tcuFornecimento: {
                        adminCentral: 1.50,
                        seguros: 0.30,
                        garantias: 0.30,
                        riscos: 0.80,
                        despFinanceiras: 0.40,
                        lucro: 3.50,
                        pis: 0.65,
                        cofins: 3.00,
                        iss: 2.00,
                        csll: 0,
                        cprb: 0
                    }
                },
                engineeringConfig: { UF: 'SP', basesConsideradas: ['SINAPI'], dataBase: '2026-04', regimeOneracao: 'DESONERADO', bdiDiferenciado: false, bdiFornecimento: 15.00, precision: { tipo: 'ROUND', casasDecimais: 2 } }
            };
            console.log(`[E2E ROUTE LOG] GET Response for ${url}:`, JSON.stringify(responseGetPayload.items));
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: responseGetPayload
            });
        });

        // Mock de extração de itens por IA
        await page.route('**/api/engineering/ai-populate', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: {
                    items: [
                        {
                            item: "1",
                            code: "88244",
                            description: "ARMADOR COM ENCARGOS COMPLEMENTARES",
                            unit: "H",
                            quantity: "50,00",
                            unitCost: "15,50",
                            unitPrice: "19,38",
                            totalPrice: "969,00",
                            type: "COMPOSICAO",
                            sourceName: "SINAPI",
                            priceAudit: {
                                isMatched: true,
                                matchedCode: "88244",
                                matchedSourceName: "SINAPI",
                                matchedUnitCost: 15.50,
                                diffPercentage: 0
                            }
                        }
                    ]
                }
            });
        });

        // Mock de busca em bases oficiais (SINAPI)
        await page.route('**/api/engineering/bases/db-sinapi/items*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: {
                    items: [
                        {
                            id: 'db-item-999',
                            code: '99901',
                            description: 'Item Oficial de Pintura E2E',
                            unit: 'M2',
                            price: 15.75,
                            recordKind: 'COMPOSICAO'
                        }
                    ]
                }
            });
        });

        // Mock do Ajuste Inteligente
        await page.route('**/api/engineering/proposals/*/ajuste-inteligente', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: { success: true }
            });
        });

        // Mock de geração de blocos de carta proposta por IA
        await page.route('**/api/proposals/ai-letter-blocks', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: {
                    blocks: {
                        objectBlock: "Objeto da licitação: Construção da praça central.",
                        executionBlock: "Execução da obra em conformidade com as especificações.",
                        commercialExtras: "Condições de pagamento conforme edital."
                    },
                    timings: {
                        objectBlock: 100,
                        executionBlock: 100,
                        commercialExtras: 100
                    }
                }
            });
        });

        // Mock de salvamento da carta proposta
        await page.route('**/api/proposals/prop-*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: { success: true }
            });
        });

        await page.route('**/api/companies/*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                json: { success: true }
            });
        });

        // --- EXECUÇÃO DO FLUXO E2E ---
        await page.goto('/');
        await expect(page.locator('.sidebar-header').locator('text=LicitaSaaS').first()).toBeVisible({ timeout: 10000 });

        // Abre a tela de Produção
        await page.click('a:has-text("Produção")');
        await expect(page.locator('text=Elaboração de Proposta de Preços')).toBeVisible({ timeout: 5000 });

// Seleciona a licitação bid-1
        const biddingSelect = page.locator('select:has-text("Selecione uma licitação")');
        await biddingSelect.locator('option[value="bid-1"]').waitFor({ state: 'attached', timeout: 5000 });
        await biddingSelect.selectOption('bid-1');

        // Confirma Passo 1 (Configuração)
        await expect(page.locator('text=Bases de Referência').first()).toBeVisible({ timeout: 5000 });
        
        // Avança para o Passo 2
        await page.click('button:has-text("Próximo: Planilha Orçamentária")');
        
        // Espera carregar o editor do Passo 2 (verificando visibilidade do botão Ajuste Inteligente)
        await expect(page.locator('button:has-text("Ajuste Inteligente")').first()).toBeVisible({ timeout: 10000 });

        // Espera a planilha orçamentária carregar os itens iniciais
        await expect(page.locator('input[value="SERVENTE COM ENCARGOS COMPLEMENTARES"]')).toBeVisible({ timeout: 10000 });

        // 1. Simula Extração por IA
        const iaMenuBtn = page.locator('button', { hasText: /^\s*IA\s*$/ }).first();
        await expect(iaMenuBtn).toBeVisible();
        await iaMenuBtn.click();

        // Escuta e aceita o confirm() de substituição de itens ao extrair por IA
        page.once('dialog', dialog => dialog.accept());
        await page.click('button:has-text("Extrair Itens do Edital")');

        // Aguarda carregar o item extraído pela IA (Armador)
        await expect(page.locator('input[value="ARMADOR COM ENCARGOS COMPLEMENTARES"]')).toBeVisible({ timeout: 10000 });

        // 2. Busca e Inclusão de item de base oficial
        await page.click('button:has-text("Composição")');
        const searchInput = page.locator('input[placeholder*="Buscar composição"]');
        await expect(searchInput).toBeVisible();
        await searchInput.fill('Pintura');
        await searchInput.press('Enter'); // Executa a busca no backend mockado
        
        // Espera o item oficial de Pintura E2E aparecer nos resultados da busca
        const searchResultRow = page.locator('tr', { hasText: 'Item Oficial de Pintura E2E' });
        await expect(searchResultRow).toBeVisible({ timeout: 5000 });
        
        // Clica no botão "Adicionar" específico daquela linha
        const addBtn = searchResultRow.locator('button:has-text("Adicionar")');
        await expect(addBtn).toBeVisible();
        await addBtn.click();
        
        // Aguarda a propagação do estado do novo item adicionado
        await page.waitForTimeout(500);

        // 3. Criação de composição própria
        const ownBtn = page.locator('button:has-text("Criar Composição Própria")');
        await expect(ownBtn).toBeVisible();
        await ownBtn.click();

        // Preenche campos do formulário inline da própria
        await page.locator('label:has-text("Código *") + input').fill('CP-PROPRIA');
        await page.locator('label:has-text("Descrição *") + input').fill('Composição Própria E2E');
        await page.locator('label:has-text("Unid.") + input').fill('M3');
        await page.locator('label:has-text("Valor Unit. *") + input').fill('250,00');
        await page.locator('label:has-text("Qtd.") + input').fill('10');

        // Cria e adiciona ao orçamento
        await page.click('button:has-text("Criar e Adicionar")');
        await page.waitForTimeout(500); // Aguarda propagação
        await page.click('button:has-text("Concluir")');

        // Verifica se a composição própria foi inserida na planilha
        await expect(page.locator('input[value="Composição Própria E2E"]')).toBeVisible({ timeout: 5000 });
        await page.waitForTimeout(500); // Aguarda propagação

        // 4. Salvar e resalvar a planilha alterando valores unitários
        const armadorRow = page.locator('tr', { has: page.locator('input[value="88244"]') });
        // Preenche a quantidade (nth 0 input number) e o valor unitário (nth 1 input number)
        const armadorUnitCostInput = armadorRow.locator('input[type="number"]').nth(1);
        await armadorUnitCostInput.fill('18.00');
        await page.waitForTimeout(500); // Aguarda propagação do input no state do Editor

        // Clica em Salvar planilha e aguarda conclusão do POST correspondente
        const savePromise = page.waitForResponse(response => 
            response.url().includes('/api/engineering/proposals/prop-1/items') && response.request().method() === 'POST'
        );
        await page.click('button:has-text("Salvar")');
        await savePromise;

        // 5. Histórico e Alternância de Versões (Retorno à proposta Inicial e Volta)
        const versionMenuBtn = page.locator('button:has-text("versões")');
        await expect(versionMenuBtn).toBeVisible();
        await versionMenuBtn.click();

        // Seleciona Versão 1 (Proposta Inicial)
        await page.click('button:has-text("Versão 1")');
        // Como mudar de versão recarrega a proposta e volta para o Passo 1, avançamos de volta para o Passo 2
        await page.click('button:has-text("Próximo: Planilha Orçamentária")');
        // Confirma que carregou a Versão 1 (apenas o Servente)
        await expect(page.locator('input[value="SERVENTE COM ENCARGOS COMPLEMENTARES"]')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('input[value="Composição Própria E2E"]')).not.toBeVisible();

        // Alterna de volta para a Versão 2
        await versionMenuBtn.click();
        await page.click('button:has-text("Versão 2")');
        // Novamente, avança para o Passo 2
        await page.click('button:has-text("Próximo: Planilha Orçamentária")');
        await expect(page.locator('input[value="Composição Própria E2E"]')).toBeVisible({ timeout: 5000 });
        
        // Aguarda a sincronização completa do estado do editor com o Wizard
        await page.waitForTimeout(1000);

        // 6. Ajuste de Proposta (Ajuste Inteligente)
        await page.click('button:has-text("Ajuste Inteligente")');
        const targetInput = page.locator('label:has-text("VALOR ALVO DA PROPOSTA") + div > input');
        await expect(targetInput).toBeVisible();
        
        // Logs de depuração
        const currentValueText = await page.locator('span:has-text("Valor Atual:") + span').innerText();
        console.log(`[E2E DEBUG] currentValueText: "${currentValueText}"`);
        
        await targetInput.fill('350000'); // Equivalente a R$ 3.500,00 (menor que o valor atual de ~4126.19)
        await page.waitForTimeout(500); // Aguarda formatação do input

        const targetValueText = await targetInput.inputValue();
        console.log(`[E2E DEBUG] targetValueText: "${targetValueText}"`);
        
        const aplicarBtn = page.locator('button:has-text("Aplicar Ajuste")');
        const isDisabled = await aplicarBtn.isDisabled();
        console.log(`[E2E DEBUG] aplicarBtn isDisabled: ${isDisabled}`);
        
        // Seleciona a estratégia "Redução de BDI"
        await page.click('text=Redução de BDI');
        await page.click('button:has-text("Aplicar Ajuste")');
        await expect(page.locator('text=Ajuste Inteligente de Proposta')).not.toBeVisible({ timeout: 5000 });

        // 7. Avanço dos Passos (Cronograma, Carta e Fechamento)
        // Passo 2 -> Passo 3 (Cronograma)
        await page.click('button:has-text("Próximo: Cronograma")');
        await expect(page.locator('text=Cronograma Físico-Financeiro')).toBeVisible({ timeout: 5000 });

        // Passo 3 -> Passo 4 (Carta Proposta)
        await page.click('button:has-text("Próximo: Carta Proposta")');
        await expect(page.locator('h3:has-text("Configuração Documental")').first()).toBeVisible({ timeout: 5000 });

        // Configuração da Carta Proposta (Clica em Gerar Rápido)
        const gerarRapidoBtn = page.locator('button:has-text("Gerar Rápido")');
        await expect(gerarRapidoBtn).toBeVisible();
        await gerarRapidoBtn.click();

        // Aguarda a IA redigir e habilitar o botão de Salvar e Concluir no Passo de Revisão
        const salvarConcluirBtn = page.locator('button:has-text("Salvar e Concluir")');
        await expect(salvarConcluirBtn).toBeVisible({ timeout: 10000 });
        await salvarConcluirBtn.click();

        // Passo 5: Fechamento/Exportação
        // Verifica a presença do Checklist e do botão de Exportar Tudo (.ZIP)
        await expect(page.locator('text=Checklist Pré-Exportação')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('button:has-text("Exportar Tudo (.ZIP)")')).toBeVisible({ timeout: 5000 });

        await page.waitForTimeout(1000);
    });
});
