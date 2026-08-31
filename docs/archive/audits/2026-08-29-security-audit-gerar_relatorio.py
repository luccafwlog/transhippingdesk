#!/usr/bin/env python3
"""Gera o snapshot PDF da auditoria arquivado em docs/archive/audits.

Uso (a partir da raiz do repositório):

    scripts/security/.venv/bin/python docs/archive/audits/2026-08-29-security-audit-gerar_relatorio.py

Se o venv não existir:

    python3 -m venv scripts/security/.venv
    scripts/security/.venv/bin/pip install -r scripts/security/requirements.txt

O conteúdo vive em `achados.py`; este arquivo só o diagrama. Para atualizar o
relatório depois de uma correção, edite os achados lá e rode isto de novo.
"""
from __future__ import annotations

import os
import sys
from collections import Counter

import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)

import importlib.util  # noqa: E402

_fonte = os.path.join(AQUI, '2026-08-29-security-audit-achados.py')
_spec = importlib.util.spec_from_file_location('auditoria_achados', _fonte)
A = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(A)

SAIDA = os.path.join(AQUI, '2026-08-29-security-audit.pdf')
NOME_RELATORIO = f'Relatório de Auditoria de Segurança — {A.PROJETO}'

TINTA = colors.HexColor('#0F172A')
CORPO = colors.HexColor('#1E293B')
SUAVE = colors.HexColor('#64748B')
LINHA = colors.HexColor('#CBD5E1')
FUNDO = colors.HexColor('#F1F5F9')
MARCA = colors.HexColor('#152238')
OURO = colors.HexColor('#D4882E')

MARGEM = 2 * cm
LARGURA_UTIL = A4[0] - 2 * MARGEM


# ---------------------------------------------------------------------------
# Estilos
# ---------------------------------------------------------------------------
def montar_estilos():
    base = getSampleStyleSheet()
    e = {}
    e['titulo_capa'] = ParagraphStyle(
        'titulo_capa', parent=base['Title'], fontName='Helvetica-Bold',
        fontSize=27, leading=33, textColor=MARCA, alignment=TA_CENTER, spaceAfter=0)
    e['sub_capa'] = ParagraphStyle(
        'sub_capa', parent=base['Normal'], fontName='Helvetica', fontSize=12.5,
        leading=19, textColor=SUAVE, alignment=TA_CENTER)
    e['h1'] = ParagraphStyle(
        'h1', parent=base['Heading1'], fontName='Helvetica-Bold', fontSize=17,
        leading=22, textColor=MARCA, spaceBefore=2, spaceAfter=10)
    e['h2'] = ParagraphStyle(
        'h2', parent=base['Heading2'], fontName='Helvetica-Bold', fontSize=12.5,
        leading=17, textColor=MARCA, spaceBefore=13, spaceAfter=6)
    e['h3'] = ParagraphStyle(
        'h3', parent=base['Heading3'], fontName='Helvetica-Bold', fontSize=10.5,
        leading=14, textColor=CORPO, spaceBefore=9, spaceAfter=3)
    e['p'] = ParagraphStyle(
        'p', parent=base['Normal'], fontName='Helvetica', fontSize=9.6,
        leading=14.6, textColor=CORPO, alignment=TA_JUSTIFY, spaceAfter=7)
    e['p_tab'] = ParagraphStyle(
        'p_tab', parent=e['p'], fontSize=8.9, leading=13.0, spaceAfter=0)
    # Cabeçalho de tabela: precisa de estilo próprio porque a cor do Paragraph
    # vence o TEXTCOLOR do TableStyle — sem isto o texto sai escuro sobre navy.
    e['th'] = ParagraphStyle(
        'th', parent=e['p_tab'], fontName='Helvetica-Bold',
        textColor=colors.white, alignment=0)
    # A linha "Local:" não pode herdar TA_JUSTIFY: com uma linha só, o justificado
    # espalha as palavras até a margem direita.
    e['local'] = ParagraphStyle(
        'local', parent=e['p_tab'], alignment=0)
    e['kpi_rot'] = ParagraphStyle(
        'kpi_rot', parent=e['p_tab'], fontName='Helvetica-Bold', fontSize=7.4,
        leading=9.6, textColor=SUAVE, alignment=TA_CENTER)
    e['rotulo'] = ParagraphStyle(
        'rotulo', parent=base['Normal'], fontName='Helvetica-Bold', fontSize=8,
        leading=11, textColor=SUAVE)
    e['mono'] = ParagraphStyle(
        'mono', parent=base['Normal'], fontName='Courier', fontSize=7.5,
        leading=10.2, textColor=colors.HexColor('#0B1220'))
    e['chip'] = ParagraphStyle(
        'chip', parent=base['Normal'], fontName='Helvetica-Bold', fontSize=7.4,
        leading=9.6, textColor=colors.white, alignment=TA_CENTER)
    e['issue'] = ParagraphStyle(
        'issue', parent=base['Normal'], fontName='Courier', fontSize=7.4,
        leading=10.0, textColor=colors.HexColor('#0B1220'))
    return e


E = montar_estilos()


def chip_severidade(sev: str) -> Table:
    """Retângulo colorido com o rótulo da severidade."""
    t = Table([[Paragraph(A.ROTULO_SEVERIDADE[sev], E['chip'])]],
              colWidths=[2.35 * cm], rowHeights=[0.52 * cm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor(A.CORES[sev])),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 2),
        ('RIGHTPADDING', (0, 0), (-1, -1), 2),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('ROUNDEDCORNERS', [3, 3, 3, 3]),
    ]))
    return t


def bloco_codigo(texto: str, largura: float) -> Table:
    """Trecho de código com fundo, borda e barra de destaque à esquerda."""
    linhas = [ln.replace('\t', '    ') for ln in texto.rstrip().split('\n')]
    limite = 96
    cortadas = []
    for ln in linhas:
        while len(ln) > limite:
            cortadas.append(ln[:limite])
            ln = '    ' + ln[limite:]
        cortadas.append(ln)
    pre = Preformatted('\n'.join(cortadas), E['mono'])
    t = Table([[pre]], colWidths=[largura])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#F8FAFC')),
        ('BOX', (0, 0), (-1, -1), 0.5, LINHA),
        ('LINEBEFORE', (0, 0), (0, -1), 2.2, OURO),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
    ]))
    return t


# ---------------------------------------------------------------------------
# Gráficos
# ---------------------------------------------------------------------------
def grafico_rosca(caminho: str, contagem: Counter):
    sevs = [s for s in A.ORDEM_SEVERIDADE if contagem.get(s)]
    valores = [contagem[s] for s in sevs]
    cores = [A.CORES[s] for s in sevs]
    rotulos = [f'{A.ROTULO_SEVERIDADE[s].title()}\n{contagem[s]}' for s in sevs]

    fig, ax = plt.subplots(figsize=(3.15, 2.30), dpi=320)
    wedges, _ = ax.pie(
        valores, colors=cores, startangle=90, counterclock=False,
        wedgeprops={'width': 0.42, 'edgecolor': 'white', 'linewidth': 2.2})
    ax.text(0, 0.08, str(sum(valores)), ha='center', va='center',
            fontsize=19, fontweight='bold', color='#0F172A')
    ax.text(0, -0.26, 'achados', ha='center', va='center',
            fontsize=7.0, color='#64748B')
    ax.legend(wedges, rotulos, loc='center left', bbox_to_anchor=(1.0, 0.5),
              frameon=False, fontsize=7.2, labelspacing=0.70,
              handlelength=1.0, handleheight=1.0)
    ax.set_aspect('equal')
    fig.tight_layout(pad=0.2)
    fig.savefig(caminho, transparent=True, bbox_inches='tight')
    plt.close(fig)


def grafico_barras(caminho: str, por_categoria: dict):
    rotulos, valores, cores = [], [], []
    for cid, nome, _ in A.CATEGORIAS:
        rotulos.append(nome.split('. ', 1)[1].split(' (')[0])
        n = por_categoria.get(cid, 0)
        valores.append(n)
        cores.append('#94A3B8' if n == 0 else A.CORES['media'])

    fig, ax = plt.subplots(figsize=(3.35, 1.95), dpi=320)
    y = range(len(rotulos))
    barras = ax.barh(list(y), valores, color=cores, height=0.58, zorder=3)
    ax.set_yticks(list(y))
    ax.set_yticklabels(rotulos, fontsize=6.9, color='#1E293B')
    ax.invert_yaxis()
    ax.set_xlim(0, max(max(valores), 1) + 1.1)
    ax.set_xticks(range(0, max(max(valores), 1) + 2))
    ax.tick_params(axis='x', labelsize=6.6, colors='#64748B')
    ax.grid(axis='x', color='#E2E8F0', linewidth=0.8, zorder=0)
    for lado in ('top', 'right', 'left'):
        ax.spines[lado].set_visible(False)
    ax.spines['bottom'].set_color('#CBD5E1')
    for barra, v in zip(barras, valores):
        ax.text(barra.get_width() + 0.14, barra.get_y() + barra.get_height() / 2,
                'nenhum' if v == 0 else str(v), va='center', fontsize=7.0,
                color='#64748B' if v == 0 else '#0F172A',
                fontweight='normal' if v == 0 else 'bold')
    fig.tight_layout(pad=0.3)
    fig.savefig(caminho, transparent=True, bbox_inches='tight')
    plt.close(fig)


# ---------------------------------------------------------------------------
# Cabeçalho / rodapé
# ---------------------------------------------------------------------------
def moldura(canvas, doc):
    canvas.saveState()
    y = A4[1] - MARGEM + 0.62 * cm
    canvas.setFont('Helvetica', 7.4)
    canvas.setFillColor(SUAVE)
    canvas.drawString(MARGEM, y, NOME_RELATORIO)
    canvas.drawRightString(A4[0] - MARGEM, y, A.DATA_AUDITORIA)
    canvas.setStrokeColor(LINHA)
    canvas.setLineWidth(0.5)
    canvas.line(MARGEM, y - 0.16 * cm, A4[0] - MARGEM, y - 0.16 * cm)

    yr = MARGEM - 0.72 * cm
    canvas.line(MARGEM, yr + 0.34 * cm, A4[0] - MARGEM, yr + 0.34 * cm)
    canvas.setFont('Helvetica', 7.4)
    canvas.drawString(MARGEM, yr, 'Documento interno — distribuição restrita')
    canvas.drawRightString(A4[0] - MARGEM, yr, f'Página {canvas.getPageNumber()}')
    canvas.restoreState()


def moldura_capa(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(MARCA)
    canvas.rect(0, A4[1] - 4.6 * cm, A4[0], 4.6 * cm, stroke=0, fill=1)
    canvas.setFillColor(OURO)
    canvas.rect(0, A4[1] - 4.75 * cm, A4[0], 0.15 * cm, stroke=0, fill=1)
    canvas.setFillColor(MARCA)
    canvas.rect(0, 0, A4[0], 1.05 * cm, stroke=0, fill=1)
    canvas.setFont('Helvetica', 7.6)
    canvas.setFillColor(colors.white)
    canvas.drawCentredString(A4[0] / 2, 0.42 * cm,
                             'Documento interno — distribuição restrita')
    canvas.restoreState()


# ---------------------------------------------------------------------------
# Seções
# ---------------------------------------------------------------------------
def secao_capa(por_sev: Counter):
    f = []
    f.append(Spacer(1, 3.9 * cm))
    f.append(Paragraph(f'Relatório de Auditoria<br/>de Segurança', E['titulo_capa']))
    f.append(Spacer(1, 0.35 * cm))
    f.append(Paragraph(
        f'<font color="#D4882E"><b>{A.PROJETO}</b></font>',
        ParagraphStyle('marca', parent=E['sub_capa'], fontSize=16, leading=20)))
    f.append(Spacer(1, 0.5 * cm))
    f.append(Paragraph(A.DATA_AUDITORIA, E['sub_capa']))
    f.append(Spacer(1, 1.5 * cm))

    total = sum(por_sev.values())
    resumo = [[
        Paragraph(f'<b>{total}</b>', ParagraphStyle(
            'n', parent=E['chip'], fontSize=19, leading=22, textColor=MARCA)),
        Paragraph(f'<b>{por_sev.get("alta", 0)}</b>', ParagraphStyle(
            'n', parent=E['chip'], fontSize=19, leading=22,
            textColor=colors.HexColor(A.CORES['alta']))),
        Paragraph(f'<b>{por_sev.get("media", 0)}</b>', ParagraphStyle(
            'n', parent=E['chip'], fontSize=19, leading=22,
            textColor=colors.HexColor(A.CORES['media']))),
        Paragraph(f'<b>{len(A.PONTOS_FORTES)}</b>', ParagraphStyle(
            'n', parent=E['chip'], fontSize=19, leading=22,
            textColor=colors.HexColor(A.CORES['forte']))),
    ], [
        Paragraph('ACHADOS', E['kpi_rot']), Paragraph('ALTA', E['kpi_rot']),
        Paragraph('MÉDIA', E['kpi_rot']), Paragraph('PONTOS FORTES', E['kpi_rot']),
    ]]
    lc = LARGURA_UTIL / 4
    t = Table(resumo, colWidths=[lc] * 4)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), FUNDO),
        ('TEXTCOLOR', (0, 1), (-1, 1), SUAVE),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, 0), 12),
        ('BOTTOMPADDING', (0, 1), (-1, 1), 12),
        ('LINEAFTER', (0, 0), (-2, -1), 0.5, colors.white),
        ('BOX', (0, 0), (-1, -1), 0.5, LINHA),
    ]))
    f.append(t)
    f.append(Spacer(1, 1.2 * cm))

    f.append(Paragraph('Escopo auditado', E['h2']))
    f.append(Paragraph(
        'Auditoria de código do repositório <font face="Courier">transhippingdesk</font> '
        f'({A.COMMIT_ESCOPO}), cobrindo cinco categorias de falha adaptadas à stack detectada. '
        'Foram examinados: as 359 migrations SQL (RLS, policies, grants e funções), as 13 Edge '
        'Functions Deno com seus helpers compartilhados, o código-fonte do frontend React, os '
        'arquivos de configuração e de deploy, o workflow de CI e o histórico git. '
        'A auditoria é estática — nenhum teste foi executado contra ambiente de produção e nenhuma '
        'exploração foi realizada.', E['p']))

    f.append(Paragraph('Stack detectada', E['h2']))
    linhas = [[Paragraph(f'<b>{k}</b>', E['p_tab']), Paragraph(v, E['p_tab'])]
              for k, v in A.STACK]
    t = Table(linhas, colWidths=[3.7 * cm, LARGURA_UTIL - 3.7 * cm])
    t.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LINEBELOW', (0, 0), (-1, -2), 0.4, colors.HexColor('#E2E8F0')),
        ('TOPPADDING', (0, 0), (-1, -1), 4.5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4.5),
        ('LEFTPADDING', (0, 0), (0, -1), 0),
    ]))
    f.append(t)

    f.append(PageBreak())
    f.append(Paragraph('Nota metodológica', E['h1']))
    f.append(Paragraph(
        'Cada uma das cinco categorias do pedido foi traduzida para o equivalente desta stack antes '
        'da varredura. O mapeamento e os limites da cobertura estão registrados abaixo para que o '
        'leitor possa julgar o alcance do resultado — inclusive das categorias que não produziram '
        'achado.', E['p']))
    for titulo, texto in A.NOTA_METODOLOGICA:
        f.append(Paragraph(titulo, E['h3']))
        f.append(Paragraph(texto, E['p']))

    f.append(PageBreak())
    f.append(Paragraph('Mapeamento das categorias', E['h1']))
    linhas = [[Paragraph('Categoria', E['th']),
               Paragraph('Equivalente auditado nesta stack', E['th'])]]
    for _, nome, mapeamento in A.CATEGORIAS:
        linhas.append([Paragraph(f'<b>{nome}</b>', E['p_tab']),
                       Paragraph(mapeamento, E['p_tab'])])
    t = Table(linhas, colWidths=[5.4 * cm, LARGURA_UTIL - 5.4 * cm], repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), MARCA),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('GRID', (0, 0), (-1, -1), 0.4, LINHA),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F8FAFC')]),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 7),
        ('RIGHTPADDING', (0, 0), (-1, -1), 7),
    ]))
    f.append(t)
    return f


def secao_resumo(por_sev: Counter, por_cat: dict, img_rosca: str, img_barras: str):
    from reportlab.platypus import Image
    f = [Paragraph('Resumo executivo', E['h1'])]

    alta = por_sev.get('alta', 0)
    f.append(Paragraph(
        f'A auditoria registrou <b>{sum(por_sev.values())} achados</b>: '
        f'<b>nenhum crítico</b>, <b>{alta} de severidade alta</b>, '
        f'<b>{por_sev.get("media", 0)} médios</b>, <b>{por_sev.get("baixa", 0)} baixos</b> e '
        f'<b>{por_sev.get("informativa", 0)} informativo</b>. Também foram registrados '
        f'<b>{len(A.PONTOS_FORTES)} pontos fortes verificados</b>, que sustentam a cobertura da '
        'varredura e explicam o resultado encontrado no snapshot.', E['p']))
    f.append(Paragraph(
        'O projeto tem histórico visível de endurecimento: várias migrations existem apenas para '
        'fechar brechas encontradas em auditorias anteriores, e a maior parte delas documenta no '
        'cabeçalho o que foi fechado e por quê. Os achados aqui não contradizem esse trabalho — '
        '<b>parte dos achados são resíduos dele</b>. São funções que uma correção anterior identificou '
        'como problema, corrigiu para o caminho não autenticado e deixou abertas para o papel '
        '<font face="Courier">authenticated</font>, ou que ficaram de fora de uma revogação em lote '
        'porque o nome não casava com o padrão usado. O risco central não é uma falha de projeto: '
        'é a ausência de verificação automatizada de um invariante que hoje depende de disciplina '
        'humana repetida em funções.', E['p']))

    f.append(Spacer(1, 0.25 * cm))
    esq = [Paragraph('Achados por severidade', E['h3']),
           Image(img_rosca, width=8.0 * cm, height=8.0 * cm * 0.70)]
    dir_ = [Paragraph('Achados por categoria', E['h3']),
            Image(img_barras, width=8.4 * cm, height=8.4 * cm * 0.47)]
    t = Table([[esq, dir_]], colWidths=[8.3 * cm, LARGURA_UTIL - 8.3 * cm])
    t.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
    ]))
    f.append(t)
    f.append(Spacer(1, 0.4 * cm))

    # Índice de achados — em página própria para a tabela não deixar linha órfã.
    f.append(PageBreak())
    f.append(Paragraph('Índice dos achados', E['h1']))
    f.append(Paragraph(
        'A coluna <b>Cat.</b> remete à categoria do pedido, detalhada na nota metodológica. '
        'Cada achado é desenvolvido, com trecho de código e correção, na seção '
        '“Achados detalhados”.', E['p']))
    linhas = [[Paragraph('#', E['th']), Paragraph('Severidade', E['th']),
               Paragraph('Achado', E['th']), Paragraph('Cat.', E['th'])]]
    for a in A.ACHADOS:
        cat = a['categoria'].replace('cat', '')
        linhas.append([
            Paragraph(f'<b>{a["id"]}</b>', E['p_tab']),
            chip_severidade(a['severidade']),
            Paragraph(a['titulo'], E['p_tab']),
            Paragraph(cat, E['p_tab']),
        ])
    t = Table(linhas, colWidths=[0.9 * cm, 2.6 * cm, LARGURA_UTIL - 4.7 * cm, 1.2 * cm],
              repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), MARCA),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ALIGN', (0, 0), (0, -1), 'CENTER'),
        ('ALIGN', (3, 0), (3, -1), 'CENTER'),
        ('GRID', (0, 0), (-1, -1), 0.4, LINHA),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F8FAFC')]),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    f.append(t)
    return f


def secao_fortes_fracos():
    f = [PageBreak(), Paragraph('Pontos fortes verificados', E['h1'])]
    f.append(Paragraph(
        'Registrado com evidência de arquivo e linha. Esta seção é a prova de cobertura da '
        'auditoria: cada item abaixo é um controle que foi procurado, encontrado e confirmado '
        'funcionando — não uma ausência de achado.', E['p']))
    f.append(Spacer(1, 0.15 * cm))

    for titulo, texto in A.PONTOS_FORTES:
        marca = Table([['']], colWidths=[0.14 * cm], rowHeights=[0.42 * cm])
        marca.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor(A.CORES['forte'])),
            ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ]))
        cabec = Table([[marca, Paragraph(f'<b>{titulo}</b>', ParagraphStyle(
            'pf', parent=E['p_tab'], fontSize=9.6, textColor=colors.HexColor('#065F46')))]],
            colWidths=[0.42 * cm, LARGURA_UTIL - 0.42 * cm])
        cabec.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ]))
        f.append(KeepTogether([cabec, Paragraph(texto, ParagraphStyle(
            'pfd', parent=E['p'], leftIndent=0.42 * cm, spaceAfter=9))]))

    f.append(PageBreak())
    f.append(Paragraph('Pontos fracos — os riscos centrais', E['h1']))
    f.append(Paragraph(
        'Os achados individuais estão detalhados na seção seguinte. Aqui ficam os três padrões '
        'estruturais dos quais eles derivam — corrigir a estrutura vale mais do que corrigir cada '
        'ocorrência.', E['p']))
    for i, (titulo, texto) in enumerate(A.PONTOS_FRACOS, 1):
        cab = Table([[Paragraph(f'<b>{i}. {titulo}</b>', ParagraphStyle(
            'pw', parent=E['p_tab'], fontSize=10, textColor=colors.HexColor('#7C2D12')))]],
            colWidths=[LARGURA_UTIL])
        cab.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#FFF7ED')),
            ('LINEBEFORE', (0, 0), (0, -1), 2.4, colors.HexColor(A.CORES['alta'])),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))
        f.append(KeepTogether([cab, Spacer(1, 0.12 * cm),
                               Paragraph(texto, ParagraphStyle(
                                   'pwd', parent=E['p'], leftIndent=0.25 * cm, spaceAfter=11))]))
    return f


def secao_achados():
    f = [PageBreak(), Paragraph('Achados detalhados', E['h1'])]
    f.append(Paragraph(
        'Agrupados pela categoria do pedido. Cada achado traz arquivo e linha exatos, o trecho de '
        'código, por que é explorável, o impacto, as condições de exploração e a correção sugerida.',
        E['p']))

    por_cat = {}
    for a in A.ACHADOS:
        por_cat.setdefault(a['categoria'], []).append(a)

    for cid, nome, _ in A.CATEGORIAS:
        f.append(Spacer(1, 0.2 * cm))
        cab = Table([[Paragraph(f'<b>{nome}</b>', ParagraphStyle(
            'cat', parent=E['p_tab'], fontSize=11, textColor=colors.white))]],
            colWidths=[LARGURA_UTIL])
        cab.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), MARCA),
            ('LEFTPADDING', (0, 0), (-1, -1), 9),
            ('TOPPADDING', (0, 0), (-1, -1), 7),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ]))
        f.append(cab)
        f.append(Spacer(1, 0.3 * cm))

        itens = por_cat.get(cid, [])
        if not itens:
            texto = next((t for c, _, t in A.SEM_ACHADO if c == cid), None)
            box = Table([[Paragraph(texto or 'Nenhum achado.', E['p_tab'])]],
                        colWidths=[LARGURA_UTIL])
            box.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#ECFDF5')),
                ('LINEBEFORE', (0, 0), (0, -1), 2.4, colors.HexColor(A.CORES['forte'])),
                ('LEFTPADDING', (0, 0), (-1, -1), 9),
                ('RIGHTPADDING', (0, 0), (-1, -1), 9),
                ('TOPPADDING', (0, 0), (-1, -1), 8),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ]))
            f.append(box)
            f.append(Spacer(1, 0.4 * cm))
            continue

        for a in itens:
            cabec = Table(
                [[chip_severidade(a['severidade']),
                  Paragraph(f'<b>Achado {a["id"]} — {a["titulo"]}</b>', ParagraphStyle(
                      'ah', parent=E['p_tab'], fontSize=10, leading=13.5, textColor=MARCA))]],
                colWidths=[2.6 * cm, LARGURA_UTIL - 2.6 * cm])
            cabec.setStyle(TableStyle([
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('LEFTPADDING', (0, 0), (0, -1), 0),
                ('TOPPADDING', (0, 0), (-1, -1), 3),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
            ]))
            f.append(cabec)
            f.append(Spacer(1, 0.14 * cm))
            f.append(Paragraph(
                f'<font color="#64748B"><b>Local:</b></font> '
                f'<font face="Courier" size="8">{a["local"]}</font>', E['local']))
            f.append(Spacer(1, 0.22 * cm))
            f.append(bloco_codigo(a['trecho'], LARGURA_UTIL))
            f.append(Spacer(1, 0.28 * cm))

            for rot, chave in (('Por que é explorável', 'porque'), ('Impacto', 'impacto'),
                               ('Condições de exploração', 'exploracao'),
                               ('Correção sugerida', 'correcao')):
                f.append(Paragraph(rot, E['h3']))
                f.append(Paragraph(a[chave], E['p']))
            f.append(Spacer(1, 0.45 * cm))
    return f


def secao_recomendacoes():
    f = [PageBreak(), Paragraph('Recomendações priorizadas', E['h1'])]
    f.append(Paragraph(
        'A prioridade combina severidade, custo de exploração e custo de correção. Os itens P1 são '
        'alterações de uma linha de SQL cada, sem impacto em consumidor de produção — o melhor '
        'retorno da lista.', E['p']))
    f.append(Spacer(1, 0.15 * cm))

    tom = {'P1': A.CORES['alta'], 'P2': A.CORES['media'], 'P3': A.CORES['baixa']}
    linhas = [[Paragraph('Prio.', E['th']), Paragraph('Ação', E['th']),
               Paragraph('Ref.', E['th']),
               Paragraph('Justificativa', E['th'])]]
    for prio, acao, ref, just in A.RECOMENDACOES:
        linhas.append([
            Paragraph(f'<b><font color="{tom[prio]}">{prio}</font></b>', E['p_tab']),
            Paragraph(f'<b>{acao}</b>', E['p_tab']),
            Paragraph(ref, E['p_tab']),
            Paragraph(just, E['p_tab']),
        ])
    t = Table(linhas, colWidths=[1.15 * cm, 4.7 * cm, 1.9 * cm, LARGURA_UTIL - 7.75 * cm],
              repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), MARCA),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('GRID', (0, 0), (-1, -1), 0.4, LINHA),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F8FAFC')]),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    f.append(t)
    return f


# ---------------------------------------------------------------------------
# Issues para o GitHub
# ---------------------------------------------------------------------------
def agrupar_issues():
    """Agrupa achados triviais do mesmo tema numa issue só, para não gerar spam."""
    mapa = {a['id']: a for a in A.ACHADOS}
    return [
        {'n': 1, 'achados': [mapa[1]],
         'titulo': '[Segurança] portal_billing_gate expõe e-mail e IDs de qualquer cliente por B/L arbitrário',
         'labels': ['security', 'severidade:alta']},
        {'n': 2, 'achados': [mapa[2]],
         'titulo': '[Segurança] refresh_voyage_status_from_terminal_scales altera status de viagem sem verificar privilégio',
         'labels': ['security', 'severidade:media']},
        {'n': 3, 'achados': [mapa[3]],
         'titulo': '[Segurança] Fechar o ACL das RPCs SECURITY DEFINER sem guarda expostas a authenticated',
         'labels': ['security', 'severidade:media'],
         'nota': 'Agrupa o achado 3: função SECURITY DEFINER concedida a '
                 '`authenticated` sem guarda no corpo) e mesma correção (fechar o ACL). Resolver '
                 'os dois no mesmo commit evita duas revisões de migration para a mesma decisão.'},
        {'n': 4, 'achados': [mapa[5], mapa[6]],
         'titulo': '[Segurança] Endurecer a autenticação por bearer secret das Edge Functions',
         'labels': ['security', 'severidade:media'],
         'nota': 'Agrupa os achados 5 e 6: os dois estão na autenticação por bearer secret das '
                 'Edge Functions e são resolvidos no mesmo arquivo compartilhado.'},
        {'n': 5, 'achados': [mapa[7], mapa[8]],
         'titulo': '[Segurança] Higiene: segredos de script local e sink latente de HTML na impressão',
         'labels': ['security', 'severidade:baixa'],
         'nota': 'Agrupa os achados 7 e 8: nenhum é explorável hoje. Uma issue só evita dois '
                 'tickets de baixa prioridade para trabalho de limpeza.'},
    ]


def markdown_issue(issue) -> str:
    L = []
    L.append(f'## {issue["titulo"]}')
    L.append('')
    L.append(f'**Labels:** `{"`, `".join(issue["labels"])}`')
    L.append('')
    if issue.get('nota'):
        nota = issue['nota']
        L.append(f'> **Por que agrupada:** {nota}')
        L.append('')

    L.append('### Problema')
    L.append('')
    for a in issue['achados']:
        prefixo = f'**[{A.ROTULO_SEVERIDADE[a["severidade"]]}] {a["titulo"]}**' \
            if len(issue['achados']) > 1 else ''
        if prefixo:
            L.append(prefixo)
            L.append('')
        L.append(limpar(a['porque']))
        L.append('')

    L.append('### Evidência')
    L.append('')
    for a in issue['achados']:
        for arq in a['arquivos']:
            L.append(f'- `{arq}`')
        L.append('')
        extensao = next((item for item in issue['achados'][0]['arquivos'] if '.' in item), '')
        L.append('```sql' if extensao.endswith('.sql') else '```ts')
        L.append(a['trecho'].rstrip())
        L.append('```')
        L.append('')

    L.append('### Impacto')
    L.append('')
    for a in issue['achados']:
        L.append(limpar(a['impacto']))
        L.append('')

    L.append('### Condições de exploração')
    L.append('')
    for a in issue['achados']:
        L.append(limpar(a['exploracao']))
        L.append('')

    L.append('### Correção sugerida')
    L.append('')
    for a in issue['achados']:
        L.append(limpar(a['correcao']))
        L.append('')

    L.append('### Critérios de aceite')
    L.append('')
    vistos = set()
    for a in issue['achados']:
        for c in a['aceite']:
            if c not in vistos:
                vistos.add(c)
                L.append(f'- [ ] {c}')
    L.append('- [ ] `npm run lint`, `npm test` e `npm run build` passam.')
    L.append('- [ ] A migration de correção traz cabeçalho com intenção, afetados e rollback '
            '(convenção do projeto).')
    return '\n'.join(L)


def limpar(html: str) -> str:
    """Converte o HTML inline dos achados em Markdown."""
    import re
    t = html
    t = t.replace('<br/><br/>', '\n\n').replace('<br/>', '\n')
    t = re.sub(r'<font face="Courier"[^>]*>(.*?)</font>', r'`\1`', t, flags=re.S)
    t = re.sub(r'<font[^>]*>(.*?)</font>', r'\1', t, flags=re.S)
    t = t.replace('<b>', '**').replace('</b>', '**')
    t = t.replace('<i>', '_').replace('</i>', '_')
    t = t.replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&')
    t = re.sub(r'[ \t]+', ' ', t)
    return '\n'.join(ln.strip() for ln in t.split('\n')).strip()


def secao_issues():
    f = [PageBreak(), Paragraph('Issues para o GitHub', E['h1'])]
    f.append(Paragraph(
        'Texto completo em Markdown, pronto para copiar e colar. Os sete achados foram agrupados em '
        '<b>cinco issues</b>: achados da mesma classe, com a mesma correção e o mesmo revisor, '
        'entram juntos para não gerar tickets redundantes. Cada bloco começa em '
        '<font face="Courier">--- ISSUE n ---</font> e termina em '
        '<font face="Courier">--- FIM ISSUE n ---</font>; copie tudo que está entre os dois '
        'delimitadores, sem incluí-los.', E['p']))
    f.append(Spacer(1, 0.2 * cm))

    issues = agrupar_issues()
    for issue in issues:
        sev = issue['achados'][0]['severidade']
        cab = Table([[Paragraph(
            f'<b>ISSUE {issue["n"]}</b> &nbsp;·&nbsp; {issue["titulo"]}',
            ParagraphStyle('ic', parent=E['p_tab'], fontSize=9.2, textColor=colors.white))]],
            colWidths=[LARGURA_UTIL])
        cab.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor(A.CORES[sev])),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))
        primeiro = [cab, Spacer(1, 0.16 * cm)]

        corpo = f'--- ISSUE {issue["n"]} ---\n\n{markdown_issue(issue)}\n\n--- FIM ISSUE {issue["n"]} ---'
        linhas = []
        for ln in corpo.split('\n'):
            ln = ln.replace('\t', '  ')
            while len(ln) > 100:
                corte = ln.rfind(' ', 0, 100)
                corte = corte if corte > 40 else 100
                linhas.append(ln[:corte])
                ln = '  ' + ln[corte:].lstrip()
            linhas.append(ln)

        # Fatia em blocos para o quadro poder quebrar entre páginas.
        for i in range(0, len(linhas), 40):
            pedaco = Preformatted('\n'.join(linhas[i:i + 40]), E['issue'])
            t = Table([[pedaco]], colWidths=[LARGURA_UTIL])
            t.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#F8FAFC')),
                ('BOX', (0, 0), (-1, -1), 0.5, LINHA),
                ('LEFTPADDING', (0, 0), (-1, -1), 8),
                ('RIGHTPADDING', (0, 0), (-1, -1), 6),
                ('TOPPADDING', (0, 0), (-1, -1), 6),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ]))
            if i == 0:
                # Banner e o inicio do bloco nunca se separam entre paginas.
                f.append(KeepTogether(primeiro + [t]))
            else:
                f.append(t)
        # Sem espaçador depois do último bloco: ele empurraria uma página em branco.
        if issue is not issues[-1]:
            f.append(Spacer(1, 0.55 * cm))
    return f


# ---------------------------------------------------------------------------
# Montagem
# ---------------------------------------------------------------------------
def main():
    por_sev = Counter(a['severidade'] for a in A.ACHADOS)
    por_cat = Counter(a['categoria'] for a in A.ACHADOS)

    img_rosca = os.path.join(AQUI, '_grafico-severidade.png')
    img_barras = os.path.join(AQUI, '_grafico-categoria.png')
    grafico_rosca(img_rosca, por_sev)
    grafico_barras(img_barras, por_cat)

    doc = BaseDocTemplate(
        SAIDA, pagesize=A4,
        leftMargin=MARGEM, rightMargin=MARGEM,
        topMargin=MARGEM, bottomMargin=MARGEM,
        title=NOME_RELATORIO, author='Auditoria de segurança',
        subject='Auditoria de segurança em cinco categorias')

    quadro = Frame(MARGEM, MARGEM, LARGURA_UTIL, A4[1] - 2 * MARGEM, id='corpo')
    doc.addPageTemplates([
        PageTemplate(id='capa', frames=[quadro], onPage=moldura_capa),
        PageTemplate(id='corpo', frames=[quadro], onPage=moldura),
    ])

    fluxo = [NextPageTemplate('corpo')]
    fluxo += secao_capa(por_sev)
    fluxo.append(PageBreak())
    fluxo += secao_resumo(por_sev, por_cat, img_rosca, img_barras)
    fluxo += secao_fortes_fracos()
    fluxo += secao_achados()
    fluxo += secao_recomendacoes()
    fluxo += secao_issues()

    doc.build(fluxo)

    for tmp in (img_rosca, img_barras):
        if os.path.exists(tmp):
            os.remove(tmp)

    print(f'PDF gerado: {SAIDA}')
    print(f'Achados: {sum(por_sev.values())} | por severidade: {dict(por_sev)}')


if __name__ == '__main__':
    main()
