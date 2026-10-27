# Escolher foto da galeria no menu da câmera

O primeiro botão do menu Câmera será `🖼️ ESCOLHER FOTO GALERIA`, seguido de Tirar foto, Escanear e Cancelar. A escolha abre a biblioteca existente de fotos do dispositivo ou o seletor de imagens no navegador, permitindo anexar uma foto já tirada.

Usar `native.pickPhotos()` reaproveita a seleção e validação de imagens já implementadas para Android, iOS e web. Criar outro seletor repetiria essas regras sem acrescentar comportamento solicitado. A opção recebe o foco inicial por ser a primeira ação.

O mesmo menu é usado no compositor, nas bandejas de formulários e ao acrescentar páginas a um anexo. Ambos os consumidores do resultado aceitarão `gallery`; no visualizador, a imagem escolhida seguirá a composição em PDF existente.

Cancelamento, proteção de sessão e seleção única em andamento continuam a proteger o rascunho e os anexos. O projeto segue a autorização permanente de executar e publicar sem confirmação adicional. Não há alteração de VM, permissões ou regras de assinatura.

Validar a seleção real, cancelamento, resposta antiga após logout, seleção para acrescentar página, fluxo de câmera/scan existente e posição visual do botão em celular e desktop. Publicar a revisão validada em web/Windows, Google Play interno e TestFlight, conferindo cada entrega.
