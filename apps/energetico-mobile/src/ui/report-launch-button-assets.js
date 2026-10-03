// Original Power Apps shortcut controls from TELA INICIAL.pa.yaml.
const controls = [
  [3, "Image23_76", "#CB6666", "top", "94fe28a6-5a08-42c5-b087-7f1d00d5b83a.png"],
  [4, "Image23_41", "#CB6666", "top", "f67c9a15-5e41-4fc3-bf67-83acc0fa6367.png"],
  [5, "Image23_39", "#CB6666", "top", "5939521a-e702-4fc5-8b64-db9463bd5e72.png"],
  [6, "Image21_7", "#CB6666", "top", "3d6a6208-8a99-466f-a44f-fe33645e04ff.png"],
  [7, "Image20_55", "#CB6666", "top", "82f1b4ce-b02d-404f-9105-4c2c09561238.png"],
  [8, "Image20_49", "#638B2C", "top", "0ce5df1d-36c2-4289-b1c7-69e97134d47b.png"],
  [9, "Image23_77", "#000D4B", "left", "de0153c5-7d90-41bc-8611-8c5b4f7a5b32.png"],
  [10, "Image4_4", "#000D4B", "left", "3d6a6208-8a99-466f-a44f-fe33645e04ff.png"],
  [11, "Image21_4", "#001060", "left", "46ea7418-ff9c-4964-8e10-8b978a771a3f.png"],
  [12, "Image21_19", "#959595", "left", "7d1875e8-106a-438a-be5c-605c1d27f0f0.png"],
  [13, "Image23_42", "#88A0D1", "left", "b0d592ed-8920-4fe7-8c0c-1169c0b6b4e6.png"],
  [14, "Image23_13", "#AC3E0B", "right", "2c7eecf0-7c1d-46f1-9577-b455a0e4d225.png"],
  [15, "Image7", "#AC3E0B", "right", "26adafd6-3b58-45c3-b4ad-152ec6d6e79e.png"],
  [16, "Image7_5", "#AC3E0B", "right", "fd57f004-7139-4557-9dcd-0f310b870f45.png"],
  [17, "Image4_5", "#FBBC9F", "right", "cdf75308-d0b7-4e02-860c-32943e5dece5.png"],
];

export const REPORT_LAUNCH_BUTTONS = Object.freeze(Object.fromEntries(controls.map(([id, control, color, group, filename]) => [
  id,
  Object.freeze({ control, color, group, imageUrl: new URL(`../../../../assets/report-mascots/${filename}`, import.meta.url).href }),
])));
