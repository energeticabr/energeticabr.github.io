# Layout Yoosee para câmeras — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refazer a aba Câmeras do Energético com visual de monitoramento do Yoosee, autoplay e adaptação a retrato, paisagem e desktop.

**Architecture:** `cameras-view.js` continua dona da lista, sessões HLS, controles PTZ e busca/reprodução de trechos. O arquivo de CSS passa a definir visualizador, gaveta de gravações e grades responsivas sem o bloqueio de orientação do helper de relatórios. O gateway e as rotas permanecem iguais.

**Tech Stack:** JavaScript ES modules, CSS, Vite, Capacitor, HLS.js.

**Spec:** `docs/superpowers/specs/2026-11-24-yoosee-cameras-layout-design.md`

## Global Constraints

- Autoplay começa silenciado, em linha (`playsinline`) e sem exigir toque no play.
- Estado “Conectando…” continua até o vídeo realmente começar; falha de autoplay oferece retomada explícita.
- Retrato empilha câmeras; paisagem coloca câmeras lado a lado; não travar a orientação do aparelho.
- Manter listagem, PTZ, playback, seleção de até oito canais, cancelamento de streams e consultas.
- Não apresentar recursos Yoosee que o Energético não suporta como operacionais.
- Não editar `automations/cameras/energetico-yoosee.service`, `automations/cameras/yoosee_source.py` nem seus artefatos locais pendentes.
- Executar `pnpm guard:signature-gestures` antes da edição móvel e antes do release.

## Review Focus

- iOS/Android bloqueiam autoplay: confirmar que `muted`, `autoplay` e `playsinline` estão definidos antes de anexar o stream e que há retomada acessível quando necessário.
- Atraso, erro HLS ou navegação para fora da tela: estado e abortos precisam continuar consistentes.
- Rotação e telas estreitas: cada stream precisa continuar visível sem corte; verificar 320×844, 390×844, 844×320, 844×390 e 1365×768 CSS px.
- Dia sem gravações e muitos resultados: filtros e lista devem continuar utilizáveis sem miniaturas falsas.
- Selecionar uma câmera dentro da grade: abrir a câmera individual e encerrar as demais transmissões, preservando o comportamento atual.

---

### Task 1: Visualizador e reprodução automática

**Files:**
- Modify: `apps/energetico-mobile/src/ui/cameras-view.js`
- Modify: `apps/energetico-mobile/tests/cameras-view.test.mjs`

**Interfaces:**
- Consumes: `list`, `start`, `move`, `listRecordings`, `playRecording` de `createCamerasView.open`.
- Produces: estado de player com status de conexão, autoplay silenciado, controles com funções reais, busca e seleção de gravações.

- [x] Atualizar as expectativas existentes para o visualizador em orientação natural e verificar que o vídeo abre com `autoplay`, `muted`, `playsInline` e sem controles nativos.
- [x] Remover `bindReportLandscape` e o bloqueio de orientação; construir cabeçalho, indicador live/playback, palco de vídeo, faixa de ações e gaveta de gravações.
- [x] Fazer a conexão aguardar o início real do vídeo para marcar o canal conectado; retentar `play()` após `canplay` ou `MANIFEST_PARSED`, mantendo autoplay silenciado.
- [x] Se o autoplay for recusado após as tentativas automáticas, mostrar estado de erro e um botão acessível para retomar; não deixar o play nativo sobre “Conectando…”.
- [x] Ligar PTZ, áudio, captura de quadro, expansão visual, data/hora, play do trecho e retorno ao vivo; preservar abortos e foco ao fechar/voltar.

### Task 2: Layout adaptável Yoosee

**Files:**
- Modify: `apps/energetico-mobile/src/ui/cameras-view.css`
- Modify: `apps/energetico-mobile/tests/cameras-layout-browser.test.mjs`
- Modify: `apps/energetico-mobile/tests/fixtures/cameras-layout.html`

**Interfaces:**
- Consumes: classes e `data-*` da Task 1.
- Produces: lista, visualizador retrato, visualizador paisagem e grade de múltiplos canais.

- [x] Atualizar a listagem para cartões de câmera com prévia e seleção múltipla, mantendo acessibilidade e áreas seguras.
- [x] Em retrato, empilhar até quatro streams, colocar a faixa de ações abaixo e deixar a gaveta inferior recolhível.
- [x] Em paisagem, exibir visualizador escuro com streams em colunas; em grades de cinco a oito canais, usar a área integral e manter tiles legíveis.
- [x] Adaptar o browser-layout existente para verificar orientação do dispositivo, limites do player e tiles, sem depender do helper de relatórios.
- [x] Revisar a prévia visual em 320×844, 390×844, 844×320, 844×390 e 1365×768; corrigir overflow, safe areas, controles cortados e conflito com teclado nativo.

### Task 3: Build e publicação

**Files:**
- Build: `apps/energetico-mobile`
- Workflow: `.github/workflows/energetico-ios.yml`
- Workflow: `.github/workflows/energetico-android.yml`

**Interfaces:**
- Consumes: código validado das Tasks 1 e 2.
- Produces: revisão publicada no web/Windows e envios identificáveis ao TestFlight e Google Play interno.

- [x] Rodar `pnpm guard:signature-gestures`, `pnpm build` e `pnpm build:pwa` em `apps/energetico-mobile`.
- [x] Conferir que as alterações staged incluem apenas arquivos desta tarefa; preservar as mudanças de serviço Yoosee ainda não commitadas.
- [x] Fazer push da revisão e acompanhar CI; exigir sucesso das verificações automatizadas antes de distribuir os pacotes.
- [x] Acionar iOS com `distribute=true` e Android com `build_play_aab=true`, `publish_play=true`, faixa `internal`, sem duplicar fluxo já iniciado por push em `main`.
- [x] Confirmar separadamente a revisão, o resultado de TestFlight, o envio ao teste interno Play e a atualização web/Windows.

### Evidências do release — 2026-11-24

- Revisão integrada: PR [#1242](https://github.com/energeticabr/energeticabr.github.io/pull/1242), commit `848b9e9dcab666dfcbedb5b41743c0e0608dedbe`.
- Web/Windows: [Deploy GitHub Pages concluído](https://github.com/energeticabr/energeticabr.github.io/actions/runs/45437890905); [Energético](https://www.energeticabr.com/energetico/) respondeu HTTP 200.
- Android: [AAB publicado na faixa de teste interno da Google Play](https://github.com/energeticabr/energeticabr.github.io/actions/runs/45437891351), com APK de teste gerado.
- iOS: [build enviada e associada ao grupo interno do TestFlight](https://github.com/energeticabr/energeticabr.github.io/actions/runs/45437890999).
