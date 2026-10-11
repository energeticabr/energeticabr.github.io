# Auditoria pública da assinatura manuscrita

Pedido: capturar os dados disponíveis da assinatura desenhada naquele momento, proteger o documento e inserir um botão no PDF acessível sem login. A autorização permanente permite implementar, validar e publicar sem nova confirmação. Execução nesta sessão.

## Fluxo

Um observador passivo, separado dos blocos protegidos de gestos, registra posições normalizadas, tempos relativos, tipo de entrada e pressão/inclinação disponíveis. Não interfere no desenho ou no arraste. Ao exportar o PNG, associa um snapshot do registro a ele. Ao preparar o PDF, envia a captura por operação autenticada e registra o hash do PNG. Arquivos reutilizados/importados são identificados como sem captura ao vivo; não inventar dinâmica antiga.

O serviço preserva original e final, cifra os movimentos detalhados, assina os registros com Ed25519 e confere os selos e hashes antes de responder. Confirmação é imutável, idempotente e vinculada à conta que operou. O servidor registra os horários de preparação, recebimento do traçado e confirmação do PDF separadamente. O relógio do servidor não é carimbo de tempo independente. O selo é da aplicação e não certificado ICP-Brasil ou prova de identidade do fornecedor.

Novos registros optam explicitamente pela consulta pública. URL HTTPS com identificador e segredo aleatório de 256 bits. Registros antigos permanecem privados. Sem listagem ou busca. Qualquer portador do link pode consultar nome informado do assinante, conta operadora (nome, sem email), método, horários, hashes e resumo da captura. Não publicar CPF, email, movimentos brutos, PDF original/final ou outros anexos.

O PDF recebe um botão com anotação de link dentro da faixa inferior de identificação. O hash final é calculado somente após gravar o PDF com botão e fica no comprovante externo; não inserir o próprio hash final no PDF. Nenhuma mensagem ou documento pessoal é enviado para testar a função.

Página pública responsiva, com texto que distingue registro preservado de arquivo conferido. A pessoa seleciona o PDF e compara SHA-256 localmente no navegador; o documento não é enviado. Disponibiliza o comprovante JSON assinado para download. Exibe aviso de identificação informada, sem prometer autenticação individual ou equivalência jurídica automática.

## Verificação

Também cifrar a imagem PNG/JPEG recebida na captura e conferir o SHA-256 dos seus bytes. Na confirmação, comparar pixels RGBA normalizados com as imagens incorporadas no PDF. Isso vincula a imagem aos recursos do arquivo, sem alegar validação visual da renderização ou autoria individual. Os tempos relativos são dados do cliente; recebimento e gravação vêm do servidor.

Testes reais de HTTP/PDF e armazenamento: acesso sem login, segredo incorreto, registro não confirmado, troca de metadados e snapshots, captura adulterada, repetição, concorrência, privacidade. Testes de DOM para eventos passivos, limpar/cancelar/nova assinatura e dados anexados ao arquivo. PDF: anotação HTTPS válida, preservação das anteriores e legibilidade. Guard de gestos e suíte móvel, build web/PWA, revisão, publicação backend/web/TestFlight/Play internal da mesma revisão.
