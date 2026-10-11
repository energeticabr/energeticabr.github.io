import {StandardFonts, PDFString, rgb} from 'pdf-lib';
import {signatureCardIcons, signatureCardIconColors} from './signature-card-icons.js';

const blue = rgb(.08, .18, .34);
const green = rgb(.09, .40, .24);

export async function drawSignatureRecordCard(pdf, page, image, {
  left, bottom, width, height, captionRatio, signerName, timestamp, recordLines, verification, opaqueInk = false,
}) {
  const captionHeight = height * captionRatio;
  const inset = Math.max(2, width * .018);
  const inkHeight = height - captionHeight;
  const inkScale = Math.min((width - 2 * inset) / image.width, (inkHeight - 2 * inset) / image.height);
  // Retain transparency behind the ink; only the identification footer is white.
  if (opaqueInk) page.drawRectangle({x:left,y:bottom,width,height,color:rgb(1,1,1),opacity:.96});
  page.drawRectangle({x:left, y:bottom, width, height:captionHeight, color:rgb(1,1,1)});
  page.drawImage(image, {x:left + (width - image.width * inkScale) / 2,
    y:bottom + captionHeight + (inkHeight - image.height * inkScale) / 2,
    width:image.width * inkScale, height:image.height * inkScale});
  const radius = Math.min(4, width * .016);
  page.drawSvgPath(`M${radius} 0 H${width-radius} Q${width} 0 ${width} ${radius} V${height-radius} Q${width} ${height} ${width-radius} ${height} H${radius} Q0 ${height} 0 ${height-radius} V${radius} Q0 0 ${radius} 0 Z`,
    {x:left, y:bottom+height, borderColor:blue, borderWidth:.8});
  page.drawLine({start:{x:left+inset,y:bottom+captionHeight}, end:{x:left+width-inset,y:bottom+captionHeight},color:blue,thickness:.7});

  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const sealWidth = verification ? width * .21 : 0;
  const sealX = left + width - inset - sealWidth;
  const records = verification ? [recordLines[0]] : recordLines;
  const labels = [signerName, timestamp, ...records];
  const rowHeight = (captionHeight - inset * 2) / labels.length;
  const iconSize = Math.min(width * .07, rowHeight * .85);
  const textX = left + inset + iconSize + width * .02;
  const textWidth = (verification ? sealX - inset : left+width-inset) - textX;
  const rowSize = Math.min(11, rowHeight * .68, width * .05);
  for (const [index, label] of labels.entries()) {
    const size = Math.min(rowSize, textWidth / Math.max(1, font.widthOfTextAtSize(label,1)));
    const centerY = bottom + captionHeight - inset - (index+.5)*rowHeight;
    const y = centerY - size*.34;
    page.drawText(label, {x:textX,y,size,font,color:blue});
    if (index < 3) page.drawSvgPath(signatureCardIcons[['person','calendar','document'][index]],
      {x:left+inset,y:centerY+iconSize/2,scale:iconSize/24,
        borderColor:rgb(...signatureCardIconColors[['person','calendar','document'][index]].map(channel=>channel/255)),borderWidth:1.8});
  }
  if (!verification) return;
  page.drawLine({start:{x:sealX-inset*.5,y:bottom+inset},end:{x:sealX-inset*.5,y:bottom+captionHeight-inset},color:rgb(.78,.82,.86),thickness:.6});
  const sealHeight = captionHeight - inset * 2;
  const sealLabels = ['Documento','assinado','eletronicamente'];
  const sealFontSize = Math.min(9, sealHeight*.125, (sealWidth-2)/normal.widthOfTextAtSize('eletronicamente',1));
  const shieldSize = Math.min(width*.11, sealHeight*.5, sealWidth*.67,
    Math.max(0,sealHeight-sealFontSize*3.45-4));
  const textBottom = bottom + inset + Math.max(0, (sealHeight - shieldSize - sealFontSize*3.45 - 4) / 2);
  page.drawSvgPath(signatureCardIcons.shield,{x:sealX+(sealWidth-shieldSize)/2,y:textBottom+sealFontSize*3.45+4+shieldSize,scale:shieldSize/24,borderColor:rgb(...signatureCardIconColors.shield.map(channel=>channel/255)),borderWidth:2.4});
  for (const [index,label] of sealLabels.entries()) page.drawText(label,
    {x:sealX+(sealWidth-normal.widthOfTextAtSize(label,sealFontSize))/2,
      y:textBottom+(2-index)*sealFontSize*1.15,size:sealFontSize,font:normal,color:green});
  const link = pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Link',
    Rect:[sealX,bottom+inset,sealX+sealWidth,bottom+captionHeight-inset],Border:[0,0,0],
    Contents:PDFString.of('Ver registro da assinatura'),
    A:{Type:'Action',S:'URI',URI:PDFString.of(verification.href)}}));
  page.node.addAnnot(link);
}
