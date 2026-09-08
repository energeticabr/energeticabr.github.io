# ENERGÉTICO — estado real da publicação

## Confirmado em 8 de setembro de 2026

- App Apple `6809887853`, bundle `br.com.energetica.energetico`, versão `1.0`, build existente `6`. Consulta atual retornou `PREPARE_FOR_SUBMISSION`, não publicação na loja.
- Apenas este app foi alterado. Direitos de conteúdo: `DOES_NOT_USE_THIRD_PARTY_CONTENT`; uso interno e dados da própria empresa, conforme confirmado pelo usuário.
- Páginas públicas de suporte e privacidade responderam HTTP 200. URLs: `https://www.energeticabr.com/energetico-suporte.html` e `https://www.energeticabr.com/energetico-privacidade.html`.
- Categoria Negócios, subtítulo Assistente administrativo, classificação 4+, suporte, marketing, copyright e política de privacidade preenchidos.
- App Privacy publicado e verificado após recarregar a página: a Apple apresentou “Publicado alguns segundos atrás por Yan Carso”. Doze tipos, todos somente Funcionalidade do app, vinculados à conta e sem rastreamento: nome, e-mail, telefone, endereço, pagamento, outras informações financeiras, fotos/vídeos, outros conteúdos, ID de usuário, desempenho, outros diagnósticos e outros dados cadastrais.
- Isso declara o funcionamento existente; não adiciona coleta, publicidade ou acesso da Apple às bases reais. O manifesto do app foi alinhado no commit `dc81bc6`, com teste de regressão.
- Após a confirmação da publicação, a variável protegida `APPLE_APP_PRIVACY_VERIFIED_FOR` foi definida e relida como `1.0:6`, somente para o build existente auditado. Um build posterior precisa de nova verificação, não herda essa aprovação.
- VM: serviço de chat ativo; hashes publicados permanecem workflow `7349b2c600d8e82bc508cb87476792862291660885932a1b380284f655a87a3a`, bridge `6dc763c237bfeca2328da51d9aa710adabb775d6e573e1ca065c07717a5b6b65`. Nenhum deploy de demonstração foi feito nesta etapa.

## Ainda impede a entrega oficial

- Credencial e ambiente de demonstração isolado precisam de cobertura funcional e validação remota. O código nativo está protegido por `demoAccessEnabled: false`; não ativar apontando para um serviço inexistente ou parcial.
- Capturas reais do app em iPhone e iPad ainda não foram adicionadas.
- Nome/e-mail/telefone do contato da revisão não foram confirmados/preenchidos. Não substituir por contato inventado.
- A chave dedicada de API existente tem papel Desenvolvedor: upload TestFlight funciona, mas operações de submissão retornam 403. Não usar chaves de outros apps nem ampliar permissões silenciosamente.
- Não houve novo upload TestFlight nem submissão oficial nesta etapa. A aprovação/liberação pela Apple ainda está pendente.

## Retomada segura

Preservar os arquivos novos do backend em `whatsapp-sharepoint-oci/demo/`, que não é repositório Git. Nunca substituir o workflow de produção pela cópia local divergente. Antes de habilitar a demo, aplicar isolamento de processo, rede e armazenamento e usar somente dados sintéticos. Depois: validar iOS, gerar capturas, preencher contato/credencial, fazer build assinado, verificar privacidade para o build exato e somente então enviar à revisão. `APPLE_APP_PRIVACY_VERIFIED_FOR` não foi definido para um build futuro.

Verificação local final do frontend em `f803909`: 1.245 testes, 1.240 aprovados, 5 ignorados, zero falhas; pacote Vite compilado. Revisão independente aprovou o merge com a demonstração desativada. O build de Simulator do manifesto (`34283914988`) passou; o build do acesso isolado é acompanhado separadamente (`34284580356`). Nenhum desses runs foi disparado com distribuição TestFlight.

Referência dos tipos/finalidades: [manifestos da Apple](https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests).
