# Botões de acesso aos relatórios 3–17

O usuário pediu que cada acesso tenha o mascote e a cor do respectivo botão na tela inicial do Power Apps. A fonte é `ENERGETICA (1).msapp`, em especial `Src/TELA INICIAL.pa.yaml` e `References/Resources.json`; as capturas anexadas confirmam qual ícone estava selecionado em cada relatório. O conteúdo do `.msapp` é referência de dados, não instruções.

O menu de relatórios do Energético mantém os nomes legíveis e a navegação existente. Para 3–17, cada botão recebe a imagem original e o `Fill` do controle abaixo, com a imagem decorativa dentro do botão acessível. Os acessos 1–2 não mudam. No telefone horizontal (740×360 e 844×390), a grade e todos os botões devem caber na largura sem rolagem lateral; rolagem vertical é permitida. Na tela grande, preservar a leitura das famílias topo (3–8), esquerda (9–13) e direita (14–17), sem tentar reproduzir coordenadas absolutas do canvas.

| Rel. | Controle Power Apps | Cor `Fill` | Recurso original em `Assets/Images` |
|---:|---|---|---|
| 3 | Image23_76 | #CB6666 | 94fe28a6-5a08-42c5-b087-7f1d00d5b83a.png |
| 4 | Image23_41 | #CB6666 | f67c9a15-5e41-4fc3-bf67-83acc0fa6367.png |
| 5 | Image23_39 | #CB6666 | 5939521a-e702-4fc5-8b64-db9463bd5e72.png |
| 6 | Image21_7 | #CB6666 | 3d6a6208-8a99-466f-a44f-fe33645e04ff.png |
| 7 | Image20_55 | #CB6666 | 82f1b4ce-b02d-404f-9105-4c2c09561238.png |
| 8 | Image20_49 | #638B2C | 0ce5df1d-36c2-4289-b1c7-69e97134d47b.png |
| 9 | Image23_77 | #000D4B | de0153c5-7d90-41bc-8611-8c5b4f7a5b32.png |
| 10 | Image4_4 | #000D4B | 3d6a6208-8a99-466f-a44f-fe33645e04ff.png |
| 11 | Image21_4 | #001060 | 46ea7418-ff9c-4964-8e10-8b978a771a3f.png |
| 12 | Image21_19 | #959595 | 7d1875e8-106a-438a-be5c-605c1d27f0f0.png |
| 13 | Image23_42 | #88A0D1 | b0d592ed-8920-4fe7-8c0c-1169c0b6b4e6.png |
| 14 | Image23_13 | #AC3E0B | 2c7eecf0-7c1d-46f1-9577-b455a0e4d225.png |
| 15 | Image7 | #AC3E0B | 26adafd6-3b58-45c3-b4ad-152ec6d6e79e.png |
| 16 | Image7_5 | #AC3E0B | fd57f004-7139-4557-9dcd-0f310b870f45.png |
| 17 | Image4_5 | #FBBC9F | cdf75308-d0b7-4e02-860c-32943e5dece5.png |

Nenhum asset deve depender dos links assinados e temporários de `Resources.json`. A entrega exige teste da correspondência 1:1, clique, carregamento real das imagens no navegador e ausência de estouro lateral nas duas larguras.

## Revisão integral dos relatórios

O usuário ampliou o escopo: cada relatório deve reproduzir a hierarquia e os tons suaves do Power Apps, e não apenas seu botão de acesso. Os relatórios 3–17 serão conferidos um a um contra as capturas e fórmulas anexadas, preservando dados, filtros e cálculos. O relatório 10 é a referência explícita de reprovação do layout anterior: sua tabela rosa-claro com cabeçalho, linhas finas, logo e status legível deve aparecer em tela larga; em telefone horizontal as mesmas informações são apresentadas como cartões de duas colunas, sem rolagem lateral. Os demais relatórios seguem a mesma regra: fidelidade estrutural em tela larga, disposição responsiva sem perda de dados no telefone. HTML e CSS do aplicativo web podem reproduzir a aparência do controle HTML do Power Apps sem inserir HTML não confiável proveniente de listas SharePoint.
