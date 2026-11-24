# Edição dos nomes das câmeras

## Resultado esperado

Cada cartão da aba Câmeras mostra um botão de lápis à direita do nome. Ao tocar nele, o usuário edita o nome sem abrir o vídeo; salvar atualiza o cartão e os títulos que usam o rótulo da câmera.

## Contexto atual

`listCameraChannels` fornece um ID estável e um rótulo de até 120 caracteres. A view não dispõe de uma operação remota de renomeação. Ela já guarda prévias em `localStorage` com chave separada por conta e ID da câmera.

## Abordagens consideradas

1. **Persistir no gateway:** sincronizaria nomes entre aparelhos, mas exigiria uma nova operação de escrita, autorização e publicação do serviço compartilhado. Não é necessário para a edição visual pedida.
2. **Guardar apelidos locais por conta e câmera:** escolhido. Segue o padrão de armazenamento da view, funciona em Web, Android e iOS, e não altera o gateway. O apelido permanece na instalação onde foi editado e não sincroniza automaticamente com outros dispositivos.
3. **Guardar somente durante a sessão:** simples, mas perderia o nome ao fechar a aba; descartado.

## Desenho

- Renderizar um botão de lápis acessível junto a cada título, inclusive no modo de seleção múltipla. O botão não abre a câmera nem altera o checkbox.
- Abrir um editor modal com o nome atual, ações Cancelar/Salvar, foco inicial no campo e retorno do foco ao lápis ao fechar. Escape cancela.
- Salvar apenas nomes não vazios após `trim`, respeitando o limite de 120 caracteres. Usar `textContent` para exibir o texto.
- Persistir em `localStorage` com a conta e o ID estável no namespace `energetico:camera-name:v1:`. Ignorar apelidos inválidos ao carregar. Se o armazenamento falhar, informar erro e não afirmar que o nome foi salvo.
- Reutilizar o campo `channel.label` para que o nome editado também apareça no visualizador.

## Fora de escopo

- Alterar nomes no serviço, sincronizar apelidos entre instalações ou modificar autenticação, rotas, gateway e streaming.
- Alterar seleção de canais, reprodução automática, PTZ e comportamento dos vídeos.
