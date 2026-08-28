'use client';

import {
  createContext,
  FC,
  useContext,
  useEffect,
  useState,
} from 'react';
import { TopTitle } from '@gitroom/frontend/components/launches/helpers/top.title.component';
import 'polotno/polotno.blueprint.css';
import { createStore } from 'polotno/model/store';
import {
  getTranslations,
  setAiTextEnabled,
  setTranslations,
} from 'polotno/config';
import Workspace from 'polotno/canvas/workspace';
import { PolotnoContainer, SidePanelWrap, WorkspaceWrap } from 'polotno';
import { SidePanel, DEFAULT_SECTIONS } from 'polotno/side-panel';
import Toolbar from 'polotno/toolbar/toolbar';
import ZoomButtons from 'polotno/toolbar/zoom-buttons';
import { Button } from '@gitroom/react/form/button';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { loadVars } from '@gitroom/react/helpers/variable.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
const polotnoLeafPaths = (
  value: Record<string, unknown>,
  prefix = ''
): string[] =>
  Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === 'object'
      ? polotnoLeafPaths(child as Record<string, unknown>, path)
      : [path];
  });

const polotnoTranslationSchema = getTranslations();

const polotnoJa = {
  toolbar: {
    duration: '再生時間',
    opacity: '不透明度',
    effects: '効果',
    blur: 'ぼかし',
    curvedText: '曲線文字',
    curvePower: '曲がり具合',
    temperature: '色温度',
    saturation: '彩度',
    contrast: '明暗差',
    shadows: '影',
    white: '白',
    black: '黒',
    vibrance: '自然な彩度',
    textBackground: '文字の背景',
    backgroundCornerRadius: '背景の角の丸み',
    backgroundOpacity: '背景の不透明度',
    backgroundPadding: '背景の余白',
    brightness: '明るさ',
    filters: 'フィルター',
    sepia: 'セピア',
    grayscale: '白黒',
    cold: '寒色',
    natural: '自然',
    warm: '暖色',
    textStroke: '文字の縁取り',
    shadow: '影',
    border: '枠線',
    cornerRadius: '角の丸み',
    copyStyle: '書式をコピー',
    uppercase: '大文字',
    position: '配置',
    layering: '重なり順',
    toForward: '最前面へ',
    up: '前面へ',
    down: '背面へ',
    toBottom: '最背面へ',
    alignLeft: '左揃え',
    alignCenter: '中央揃え',
    alignRight: '右揃え',
    alignTop: '上揃え',
    alignMiddle: '上下中央揃え',
    alignBottom: '下揃え',
    flip: '反転',
    flipHorizontally: '左右反転',
    flipVertically: '上下反転',
    fitToBackground: 'ページに合わせる',
    removeBackground: '背景を削除',
    removeBackgroundTitle: '画像の背景を削除',
    cancelRemoveBackground: 'キャンセル',
    confirmRemoveBackground: '実行',
    crop: '切り抜き',
    cropDone: '完了',
    cropCancel: 'キャンセル',
    clip: 'マスクを適用',
    removeClip: 'マスクを解除',
    removeMask: 'マスクを解除',
    transparency: '透明度',
    lockedDescription:
      '要素はロックされています。キャンバス上で変更するにはロックを解除してください。',
    unlockedDescription:
      '要素のロックは解除されています。キャンバス上の変更を防ぐにはロックしてください。',
    removeElements: '要素を削除',
    duplicateElements: '要素を複製',
    download: '端末に保存',
    saveAsImage: '画像として保存',
    saveAsPDF: 'ＰＤＦ形式で保存',
    lineHeight: '行の高さ',
    letterSpacing: '文字間隔',
    offsetX: '横方向のずれ',
    offsetY: '縦方向のずれ',
    color: '色',
    selectable: '選択可能',
    draggable: '移動可能',
    removable: '削除可能',
    resizable: 'サイズ変更可能',
    contentEditable: '内容を変更可能',
    styleEditable: '書式を変更可能',
    alwaysOnTop: '常に最前面',
    showInExport: '書き出しに含める',
    ungroupElements: 'グループ解除',
    groupElements: 'グループ化',
    lineSize: '線の太さ',
    fade: '徐々に表示',
    move: '移動',
    zoom: '拡大縮小',
    animate: '動きを付ける',
    rotate: '回転',
    none: 'なし',
    bounce: '跳ねる',
    blink: '点滅',
    strength: '強さ',
    spaceEvenly: '均等に配置',
    horizontalDistribution: '横方向に均等配置',
    verticalDistribution: '縦方向に均等配置',
    strokeWidth: '線幅',
    strokeSettings: '線の設定',
    spacing: '間隔',
    volume: '音量',
    lineStyle: '線の種類',
    lineStartHead: '始点の形',
    lineEndHead: '終点の形',
    textDirection: '文字方向',
    fontSize: '文字サイズ',
    fontFamily: '書体',
    textAlign: '横位置',
    verticalAlign: '縦位置',
    bold: '太字',
    italic: '斜体',
    underline: '下線',
    strikethrough: '取り消し線',
    cellBackground: 'セルの背景',
    tableBorderSettings: '表の枠線設定',
    tableBorderColor: '枠線の色',
    tableBorderWidth: '枠線の太さ',
    tableBorderStyle: '枠線の種類',
    borderAllSides: 'すべての辺',
    borderTop: '上辺',
    borderBottom: '下辺',
    borderLeft: '左辺',
    borderRight: '右辺',
    borderNone: '枠線なし',
    tableStructure: '表の構成',
    tableRows: '行',
    tableColumns: '列',
    insertRowAbove: '上に行を追加',
    insertRowBelow: '下に行を追加',
    deleteRow: '行を削除',
    insertColumnLeft: '左に列を追加',
    insertColumnRight: '右に列を追加',
    deleteColumn: '列を削除',
    distributeRowsEvenly: '行の高さを均等にする',
    distributeColumnsEvenly: '列の幅を均等にする',
    cellPadding: 'セルの余白',
    listFormat: 'リスト',
    colorPicker: {
      solid: '単色',
      linear: '線形グラデーション',
      angle: '角度',
    },
    aiText: {
      aiWrite: 'ＡＩ文章作成',
      rewrite: '書き換え',
      shorten: '短くする',
      continue: '続きを書く',
      proofread: '校正',
      tones: '文体',
      friendly: '親しみやすい',
      professional: '専門的',
      humorous: 'ユーモアのある',
      formal: 'かしこまった',
      customPrompt: '独自の指示',
      generatedResult: '生成結果',
      cancel: 'キャンセル',
      generate: '生成',
      back: '戻る',
      tryAgain: 'もう一度試す',
      insert: '挿入',
      promptPlaceholder: '生成したい文章の内容を入力してください',
    },
  },
  workspace: {
    noPages: 'ページがまだありません…',
    addPage: 'ページを追加',
    removePage: 'ページを削除',
    duplicatePage: 'ページを複製',
    moveUp: '上へ移動',
    moveDown: '下へ移動',
    moveLeft: '左へ移動',
    moveRight: '右へ移動',
  },
  scale: {
    reset: '拡大率をリセット',
  },
  error: {
    removeBackground: '問題が発生したため、背景を削除できませんでした。',
  },
  sidePanel: {
    templates: 'テンプレート',
    searchTemplatesWithSameSize: '同じサイズのテンプレートを表示',
    searchPlaceholder: '検索…',
    otherFormats: 'その他の形式',
    noResults: '該当する項目がありません',
    error: '読み込みに失敗しました…',
    text: 'テキスト',
    uploadFont: '書体を追加',
    myFonts: '登録済みの書体',
    photos: '写真',
    videos: '動画',
    animations: '動き',
    effects: '効果',
    elements: '素材',
    shapes: '図形',
    tables: '表',
    lines: '線',
    draw: '描画',
    upload: 'アップロード',
    uploadImage: 'ファイルを追加',
    uploadTip: '素材をアップロード',
    background: '背景',
    resize: 'サイズ変更',
    layers: 'レイヤー',
    animate: '動きを付ける',
    layerTypes: {
      image: '画像',
      text: 'テキスト',
      svg: 'ＳＶＧ画像',
      line: '線',
      figure: '図形',
      group: 'グループ',
    },
    layersTip: '現在のページにある要素：',
    noLayers: 'このページに要素はありません…',
    namePlaceholder: '要素名を入力…',
    useMagicResize: '自動サイズ調整を使う',
    clipImage: '画像をマスク',
    width: '幅',
    height: '高さ',
    magicResizeDescription:
      '自動サイズ調整により、キャンバス上のすべての要素のサイズと位置が調整されます',
    headerText: '大見出し',
    createHeader: '大見出しを追加',
    subHeaderText: '小見出し',
    createSubHeader: '小見出しを追加',
    bodyText: '本文',
    createBody: '本文を追加',
  },
  pagesTimeline: {
    pages: 'ページ',
    removePage: 'ページを削除',
    addPage: 'ページを追加',
    duplicatePage: 'ページを複製',
    removeAudio: '音声を削除',
    duplicateAudio: '音声を複製',
    muteAudio: '消音',
    unmuteAudio: '消音を解除',
    volume: '音量',
  },
  contextMenu: {
    duplicate: '複製',
    remove: '削除',
    lock: 'ロック',
    unlock: 'ロック解除',
    copy: 'コピー',
    paste: '貼り付け',
    copyStyle: '書式をコピー',
    moveUp: '前面へ',
    moveDown: '背面へ',
    moveBack: '最背面へ',
    moveForward: '最前面へ',
  },
} satisfies ReturnType<typeof getTranslations>;

const polotnoSchemaKeys = polotnoLeafPaths(polotnoTranslationSchema).sort();
const polotnoJaKeys = polotnoLeafPaths(polotnoJa).sort();
if (
  polotnoSchemaKeys.length !== polotnoJaKeys.length ||
  polotnoSchemaKeys.some((key, index) => key !== polotnoJaKeys[index])
) {
  throw new Error('Polotnoの翻訳schemaが固定版と一致しません。');
}

setAiTextEnabled(false);
setTranslations(polotnoJa, { validate: true });

const store = createStore({
  get key() {
    return loadVars().plontoKey;
  },
  showCredit: false,
});

// @ts-ignore
const CloseContext = createContext({
  close: {} as any,
  setMedia: {} as any,
});
const ActionControls = ({ store }: any) => {
  const t = useT();
  const close = useContext(CloseContext);
  const [load, setLoad] = useState(false);
  const fetch = useFetch();
  return (
    <div>
      <Button
        loading={load}
        className="outline-none"
        innerClassName="invert outline-none text-black"
        onClick={async () => {
          setLoad(true);
          const blob = await store.toBlob();
          const formData = new FormData();
          formData.append('file', blob, 'media.png');
          const data = await (
            await fetch('/media/upload-simple', {
              method: 'POST',
              body: formData,
            })
          ).json();
          close.setMedia([
            {
              id: data.id,
              path: data.path,
            },
          ]);
          close.close();
        }}
      >
        {t('use_this_media', 'Use this media')}
      </Button>
    </div>
  );
};
const Polonto: FC<{
  setMedia: (params: { id: string; path: string }[]) => void;
  type?: 'image' | 'video';
  closeModal: () => void;
  width?: number;
  height?: number;
}> = (props) => {
  const { setMedia, type, closeModal } = props;

  const setActivateExitButton = useLaunchStore((e) => e.setActivateExitButton);
  useEffect(() => {
    setActivateExitButton(false);
    return () => {
      setActivateExitButton(true);
    };
  }, []);

  const features = DEFAULT_SECTIONS as any[];
  useEffect(() => {
    store.addPage({
      width: props.width || 540,
      height: props.height || 675,
    });
    return () => {
      store.clear();
    };
  }, []);
  return (
    <div className="bg-white text-black relative z-[400] polonto">
      <CloseContext.Provider
        value={{
          close: () => closeModal(),
          setMedia,
        }}
      >
        <PolotnoContainer
          style={{
            width: '100%',
            height: '700px',
          }}
        >
          <SidePanelWrap>
            <SidePanel store={store} sections={features} />
          </SidePanelWrap>
          <WorkspaceWrap>
            <Toolbar
              store={store}
              components={{
                ActionControls,
              }}
            />
            <Workspace store={store} />
            <ZoomButtons store={store} />
          </WorkspaceWrap>
        </PolotnoContainer>
      </CloseContext.Provider>
    </div>
  );
};
export default Polonto;
