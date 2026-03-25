"""
M2A Chat Extractor — Extrai mensagens do chat de licitação do M2A Compras.

A plataforma M2A renderiza o chat em HTML server-side (Django templates).
As mensagens são extraídas via parsing do HTML com selectolax ou regex.

Estrutura do chat (descoberta via exploração):
- O chat fica em: /fornecedores/contratacao/.../chat_licitacao/{processo_id}/
- Alternativa: embutido na página de detalhes do processo
- Usa Pusher para atualizações real-time (WebSocket)

Formatos de mensagem esperados:
- Mensagens do sistema (status changes, eventos automáticos)
- Mensagens do pregoeiro (comunicados, decisões)
- Mensagens de fornecedores (esclarecimentos, recursos)

Cada mensagem contém:
- conteúdo textual
- autor/remetente 
- data/hora
- tipo (sistema/pregoeiro/fornecedor)
"""

import hashlib
import logging
import re
from dataclasses import dataclass
from typing import List, Optional

logger = logging.getLogger('m2a.extractor')


@dataclass
class M2AChatMessage:
    """Mensagem extraída do chat M2A Compras."""
    msg_id: str
    content: str
    author_type: str  # 'pregoeiro', 'sistema', 'fornecedor'
    author_name: str = ''
    timestamp: str = ''
    event_category: str = ''

    def to_ingest_dict(self) -> dict:
        """Formato compatível com POST /api/chat-monitor/internal/ingest."""
        return {
            'messageId': self.msg_id,
            'content': self.content,
            'authorType': self.author_type,
            'authorCnpj': '',
            'eventCategory': self.event_category,
            'itemRef': '',
            'timestamp': self.timestamp,
            'captureSource': 'm2a-watcher',
        }


def make_hash(content: str, author: str, timestamp: str) -> str:
    """Gera hash único para deduplicação."""
    raw = f'm2a|{author}|{content}|{timestamp}'
    return hashlib.md5(raw.encode()).hexdigest()[:16]


def classify_author(author_text: str) -> str:
    """Classifica o tipo do autor pela label."""
    lower = author_text.lower().strip()
    
    if any(k in lower for k in ('sistema', 'automátic', 'auto')):
        return 'sistema'
    
    if any(k in lower for k in (
        'pregoeiro', 'pregoeira', 'comissão', 'agente', 
        'presidente', 'autoridade', 'equipe de apoio',
        'contratação', 'licitação'
    )):
        return 'pregoeiro'
    
    if any(k in lower for k in ('fornecedor', 'licitante', 'participante', 'empresa')):
        return 'fornecedor'
    
    return 'sistema'


def classify_event(content: str) -> str:
    """Categoriza o evento da mensagem pelo conteúdo."""
    lower = content.lower()
    
    if any(k in lower for k in ('suspens', 'suspenso', 'suspensa')):
        return 'suspensao'
    if any(k in lower for k in ('reabert', 'reabrir', 'reabriu')):
        return 'reabertura'
    if any(k in lower for k in ('vencedor', 'arrematante', 'adjudicad')):
        return 'resultado'
    if any(k in lower for k in ('convocad', 'convocação')):
        return 'convocacao'
    if any(k in lower for k in ('habilitaç', 'habilitar', 'habilitad')):
        return 'habilitacao'
    if any(k in lower for k in ('recurso', 'impugnaç')):
        return 'recurso'
    if any(k in lower for k in ('desclassific',)):
        return 'desclassificacao'
    if any(k in lower for k in ('lance', 'proposta', 'valor')):
        return 'lance'
    if any(k in lower for k in ('encerrad', 'encerramento', 'finaliz')):
        return 'encerramento'
    if any(k in lower for k in ('início', 'iniciada', 'abertura', 'aberta')):
        return 'abertura'
    
    return ''


class M2AChatExtractor:
    """
    Extrai mensagens de chat do M2A Compras a partir do HTML.
    
    O extractor suporta múltiplos formatos de HTML já que a estrutura
    exata do chat pode variar entre versões do M2A.
    """

    # Padrões regex para extrair mensagens do HTML do chat
    # Padrão 1: Tabela de mensagens (formato típico Django admin-like)
    PATTERN_TABLE_ROW = re.compile(
        r'<tr[^>]*class=["\'][^"\']*(?:mensagem|message|chat-row)[^"\']*["\'][^>]*>'
        r'(.*?)</tr>',
        re.DOTALL | re.IGNORECASE
    )

    # Padrão 2: Div de mensagem (chat widget style)
    PATTERN_CHAT_DIV = re.compile(
        r'<div[^>]*class=["\'][^"\']*(?:chat-message|mensagem-chat|msg-item)[^"\']*["\'][^>]*>'
        r'(.*?)</div>',
        re.DOTALL | re.IGNORECASE
    )

    # Padrão 3: List item de mensagem (chat list style)
    PATTERN_CHAT_LI = re.compile(
        r'<li[^>]*class=["\'][^"\']*(?:chat-message|mensagem|message)[^"\']*["\'][^>]*>'
        r'(.*?)</li>',
        re.DOTALL | re.IGNORECASE
    )

    # Padrão genérico para extrair texto, autor e data de um bloco HTML
    PATTERN_AUTHOR = re.compile(
        r'(?:class=["\'][^"\']*(?:autor|author|remetente|sender|user-name)[^"\']*["\'][^>]*>)'
        r'\s*(.*?)\s*</(?:span|div|strong|b|p)>',
        re.DOTALL | re.IGNORECASE
    )

    PATTERN_TIMESTAMP = re.compile(
        r'(?:class=["\'][^"\']*(?:data|date|time|hora|timestamp)[^"\']*["\'][^>]*>)'
        r'\s*(.*?)\s*</(?:span|div|small|time|p)>',
        re.DOTALL | re.IGNORECASE
    )

    PATTERN_CONTENT = re.compile(
        r'(?:class=["\'][^"\']*(?:conteudo|content|texto|text|mensagem-texto|message-text|msg-text)[^"\']*["\'][^>]*>)'
        r'\s*(.*?)\s*</(?:span|div|p|td)>',
        re.DOTALL | re.IGNORECASE
    )

    def __init__(self):
        self._seen_hashes: set = set()

    @staticmethod
    def _clean_html(text: str) -> str:
        """Remove tags HTML e normaliza espaços."""
        text = re.sub(r'<[^>]+>', '', text)
        text = re.sub(r'&nbsp;', ' ', text)
        text = re.sub(r'&amp;', '&', text)
        text = re.sub(r'&lt;', '<', text)
        text = re.sub(r'&gt;', '>', text)
        text = re.sub(r'&#\d+;', '', text)
        text = re.sub(r'\s+', ' ', text).strip()
        return text

    def extract_from_html(self, html: str) -> List[M2AChatMessage]:
        """
        Extrai mensagens de chat do HTML retornado pela plataforma.
        
        Prioridade:
        1. Tabela M2A (endpoint /visualizar_todas_mensagens_table/)
        2. Padrões genéricos (table row, div, li)
        3. Extração genérica por data/hora
        """
        messages: List[M2AChatMessage] = []

        # Prioridade 1: Parser de tabela M2A (Data | Autor | Mensagem)
        messages = self._extract_m2a_table(html)
        if messages:
            return messages

        # Prioridade 2: Tentar cada padrão de extração genérico
        for pattern_name, block_pattern in [
            ('table', self.PATTERN_TABLE_ROW),
            ('div', self.PATTERN_CHAT_DIV),
            ('li', self.PATTERN_CHAT_LI),
        ]:
            blocks = block_pattern.findall(html)
            if blocks:
                logger.info(f'Padrão "{pattern_name}" encontrou {len(blocks)} blocos de mensagem')
                for block in blocks:
                    msg = self._parse_message_block(block)
                    if msg:
                        messages.append(msg)
                if messages:
                    break  # Usar o primeiro padrão que funciona

        # Prioridade 3: Fallback extração genérica de texto do chat
        if not messages:
            messages = self._extract_generic(html)

        return messages

    def _extract_m2a_table(self, html: str) -> List[M2AChatMessage]:
        """
        Parser específico para a tabela de mensagens do M2A.
        
        O endpoint /contratacao/visualizar_todas_mensagens_table/{id}/
        retorna HTML com tabela contendo <tr> com 3 <td>:
          - Cell 0: Data/hora (ex: "25/03/2026 11:27")
          - Cell 1: Autor (ex: "ILUMICON CONSTRUCOES E SERVICOS LTDA")  
          - Cell 2: Mensagem (texto da mensagem)
        """
        messages: List[M2AChatMessage] = []

        # Extrair todas as linhas da tabela
        rows = re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.DOTALL)
        if not rows:
            return messages

        for row in rows:
            cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
            if len(cells) < 3:
                continue

            # Extrair e limpar cada campo
            date_raw = self._clean_html(cells[0])
            author_raw = self._clean_html(cells[1])
            content_raw = self._clean_html(cells[2])

            # Validar: data deve ter formato DD/MM/YYYY HH:MM
            if not re.match(r'\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}', date_raw):
                continue

            # Validar: conteúdo não pode ser vazio
            if not content_raw or len(content_raw) < 2:
                continue

            # Classificar autor
            author_type = classify_author(author_raw) if author_raw else 'sistema'
            event_category = classify_event(content_raw)

            # Gerar ID único
            msg_id = make_hash(content_raw, author_type, date_raw)

            messages.append(M2AChatMessage(
                msg_id=msg_id,
                content=content_raw[:2000],
                author_type=author_type,
                author_name=author_raw,
                timestamp=date_raw,
                event_category=event_category,
            ))

        if messages:
            logger.info(
                f'📋 Parser M2A Table extraiu {len(messages)} mensagem(ns)'
            )

        return messages

    def _parse_message_block(self, block_html: str) -> Optional[M2AChatMessage]:
        """Parseia um bloco HTML individual de mensagem."""
        # Extrair autor
        author_match = self.PATTERN_AUTHOR.search(block_html)
        author_raw = self._clean_html(author_match.group(1)) if author_match else ''

        # Extrair timestamp
        ts_match = self.PATTERN_TIMESTAMP.search(block_html)
        timestamp = self._clean_html(ts_match.group(1)) if ts_match else ''

        # Extrair conteúdo
        content_match = self.PATTERN_CONTENT.search(block_html)
        content = self._clean_html(content_match.group(1)) if content_match else ''

        # Se não encontrou conteúdo via padrão, usar texto limpo do bloco inteiro
        if not content:
            content = self._clean_html(block_html)
            # Remover autor e timestamp do conteúdo se já extraídos
            if author_raw:
                content = content.replace(author_raw, '').strip()
            if timestamp:
                content = content.replace(timestamp, '').strip()

        # Ignorar mensagens vazias ou muito curtas
        if not content or len(content) < 3:
            return None

        # Classificar
        author_type = classify_author(author_raw) if author_raw else 'sistema'
        event_category = classify_event(content)

        # Gerar ID único
        msg_id = make_hash(content, author_type, timestamp)

        return M2AChatMessage(
            msg_id=msg_id,
            content=content[:2000],
            author_type=author_type,
            author_name=author_raw,
            timestamp=timestamp,
            event_category=event_category,
        )

    def _extract_generic(self, html: str) -> List[M2AChatMessage]:
        """
        Extração genérica: busca padrões de data/hora seguidos de texto.
        Útil quando a estrutura exata do HTML é desconhecida.
        """
        messages: List[M2AChatMessage] = []

        # Padrão: "DD/MM/YYYY HH:MM" ou "DD/MM/YYYY às HH:MM" seguido de texto
        pattern = re.compile(
            r'(\d{2}/\d{2}/\d{4})\s*(?:às?\s*)?(\d{2}:\d{2}(?::\d{2})?)\s*'
            r'[:\-–—]?\s*'
            r'([^\n<]{10,500})',
            re.IGNORECASE
        )

        for match in pattern.finditer(html):
            date_str = match.group(1)
            time_str = match.group(2)
            content_raw = match.group(3)
            
            content = self._clean_html(content_raw).strip()
            if not content or len(content) < 5:
                continue

            timestamp = f'{date_str} {time_str}'
            msg_id = make_hash(content, 'sistema', timestamp)

            messages.append(M2AChatMessage(
                msg_id=msg_id,
                content=content[:2000],
                author_type='sistema',
                timestamp=timestamp,
                event_category=classify_event(content),
            ))

        if messages:
            logger.info(f'Extração genérica encontrou {len(messages)} mensagens')

        return messages

    def get_new_messages(self, html: str) -> List[M2AChatMessage]:
        """Retorna apenas mensagens não vistas anteriormente."""
        all_msgs = self.extract_from_html(html)
        new_msgs = [m for m in all_msgs if m.msg_id not in self._seen_hashes]

        for msg in new_msgs:
            self._seen_hashes.add(msg.msg_id)

        return new_msgs

    def extract_process_status(self, html: str) -> dict:
        """
        Extrai informações de status do processo da página de detalhes.
        Útil para detectar mudanças mesmo sem acesso ao chat.
        """
        status_info = {
            'session_status': '',
            'situation': '',
            'has_chat': False,
        }

        # Detectar status da sessão
        session_patterns = [
            (r'(?:Sessão|sessão)\s*:\s*(Iniciada|A iniciar|Encerrada|Suspensa)', 'session_status'),
            (r'(?:Situação|situação)\s*:\s*([^<\n]+)', 'situation'),
        ]

        for pattern, key in session_patterns:
            match = re.search(pattern, html, re.IGNORECASE)
            if match:
                status_info[key] = match.group(1).strip()

        # Detectar presença do chat
        chat_indicators = [
            'chat_licitacao', 'chat-licitacao', 'chat da licitação',
            'sala de disputa', 'sala_disputa',
        ]
        status_info['has_chat'] = any(ind in html.lower() for ind in chat_indicators)

        return status_info
