# Captura de CT-e e NFS-e na galeria fiscal

Autorização: incluir CT-e e notas de serviço reais, usando fontes oficiais e o A1 existente. Mantidos corte de emissão desde01/10/2026, horários09/15/20BRT, PDFs próprios à esquerda e aviso vermelho apenas para retenção pelo comprador declarada no documento. Não emitir documentos, manifestações ou pagamentos.

## Implementação

1. Conectores independentes CT-e e NFS-e ADN, cada qual com cursor, reserva antes de consulta, resposta bruta durável e arquivo por documento antes de confirmar cursor.
2. Normalização comum com origem/tipo/modelo, prestador/transportadora, tomador, emissão original, totais, líquido, observações e retenções. Chaves nacionais NFS-e50dígitos e NSUint64 até19dígitos preservados como texto.
3. Mesmo receptor PowerAutomate e lista SharePoint, chave única expandida64caracteres, tipos autorizados explícitos, replay de eventos sem apagar valores ou PDF completo.
4. DACTE quando compatível e espelho fiel do XML para os formatos sem renderizador, sem inventar nota a partir de resumo. Os bytes do PDF confirmado no SharePoint seguem na notificação existente; textoA/PDF_A antes do próximo documento.
5. Worker auxiliar isolado por fonte, chamado pelo trabalhador existente antes do bloqueio de NF-e. O agendamento permanece09/15/20; repetição por minuto atende filas/retries, sem transformar em consulta fiscal por minuto.
6. Galeria única com identificação e filtro NF-e/CT-e/NFS-e, PDF próprio, dados de tomador/serviço e retenção restrita ao responsável confirmado.
7. Verificação offline, consultas reais preservadas, integração comprovada, revisão e publicação Android interno/TestFlight/Windows. Não declarar cobertura municipal ou histórica completa sem evidência.

## Fontes e cobertura

CT-e: NT2015.002v1.04 e relação oficial de serviços. NFS-e: API de Distribuição de Contribuintes do ADN e leiaute nacional vigente. O ADN entrega documentos compartilhados em que a empresa figure como participante; integrações municipais adicionais só podem ser consideradas ativas após acesso e prova específicos. Não usar SIEG.
