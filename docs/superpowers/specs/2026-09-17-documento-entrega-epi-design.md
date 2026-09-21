# Documento de Entrega de EPI no assinador

## Objetivo

Adicionar uma escolha intermediária em `Auditoria e documentos > Assinar documentos` sem alterar o comportamento do assinador avulso existente.

## Fluxos

O menu inicial do assinador oferece:

1. `DOCUMENTO ENTREGA EPI`
2. `ASSINAR DOCUMENTO AVULSO`

O segundo item abre exatamente o fluxo atual de envio de PDF. O primeiro coleta:

- data da entrega, com atalho `HOJE`, digitação e calendário;
- fornecedor ativo e marcado como empreiteiro;
- um produto ativo da subfamília EPI e sua unidade;
- quantidade, usando `1` como resposta rápida e aceitando valor positivo digitado;
- confirmação para incluir outro produto, repetindo produto e quantidade quando necessário.

## Dados dinâmicos

Fornecedores são consultados em `FORNECEDORES`, filtrando `EMPREITEIRO = SIM` e `STATUS = ATIVO`. A opção preserva os campos da origem, incluindo documento/CPF e filial.

Produtos são consultados em `CADASTROPRODUTO`, filtrando `STATUS = ATIVO` e `SUBFAMÍLIA = EPI`. A opção preserva `PRODUTO` e `UNIDADE`.

## Documento

O servidor monta HTML compatível com o modelo fornecido e gera um PDF A4 com:

- empresa `ENERGÉTICA CONSTRUTORA`;
- CNPJ `38.626.750/0001-46`;
- fornecedor, documento/CPF e data da entrega;
- tabela numerada de produtos, quantidades e unidades;
- área de assinatura.

Valores dinâmicos são escapados no HTML. O PDF gerado entra no assinador existente como documento-fonte. O usuário envia ou desenha a assinatura, posiciona, redimensiona e pode substituí-la antes de continuar.

## Persistência

Depois da confirmação da posição, o servidor gera o PDF assinado e cria um item em `DOCUMENTOS` com:

- `DATA`: data atual;
- `DATAVALIDADE`: em branco;
- `DATASUBMETIDO`: data atual;
- `PESSOARELACIONADA`: fornecedor selecionado;
- `TIPOHOMOLOGACAO`: `HOMOLOGAÇÃO MÃO DE OBRA`;
- `FILIAL`: filial do cadastro do fornecedor;
- `TIPODOCUMENTO`: `COMPROVANTE ENTREGA EPI`;
- `STATUS`: `SUBMETIDO`;
- `IMOVEL`: `TODOS`;
- `OBS`: resumo dos EPIs e quantidades;
- anexo: PDF assinado.

A operação usa um identificador idempotente exclusivo por emissão para impedir
duplicação em repetição do mesmo evento sem reaproveitar um documento anterior.

## Compatibilidade e falhas

- Conversas antigas já no estágio de envio de PDF continuam aceitas.
- Falhas ao gerar, assinar ou gravar preservam o fluxo e exibem orientação de nova tentativa.
- Quantidades não finitas, zeradas ou negativas são recusadas antes da geração.
- Mensagens de erro não expõem detalhes internos do conector.
- A navegação de voltar/início permanece disponível por meio do `activeFlow` atual.
- O calendário aparece pela própria formulação da pergunta de data, sem interface exclusiva para o novo fluxo.
