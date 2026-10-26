import type { ComponentProps } from "react";

import { BookmarkEditor } from "@/features/bookmarks/editor";
import { DownloadsPanel } from "@/features/downloads/panel";
import { ExtensionMenu } from "@/features/extensions/menu";
import { ExtensionsPanel } from "@/features/extensions/panel";
import { ToolsMenu } from "@/features/tools/tools-menu";
import { ColorToolsPanel } from "@/features/colors/panel";
import { AutofillPopup } from "@/features/key/autofill-popup";
import { KeyPanel } from "@/features/key/panel";
import { PrivacyPanel } from "@/features/privacy/panel";
import { AppMenu } from "@/features/settings/menu";
import { SitePanel } from "@/features/site/panel";
import { TranslationBubble } from "@/features/translate/bubble";
import { TranslatePagePanel } from "@/features/translate/page-panel";
import { CastMenu } from "@/features/cast/menu";
import { YtdlpMenu } from "@/features/ytdlp/menu";

import { CommandPalette } from "../ui/command-palette";
import { ReloadMenu } from "../ui/reload-menu";
import { FolderMenu } from "../ui/folder-dropdown";
import { GroupEditor } from "../ui/group-editor";
import { SideAppsMenu } from "../ui/side-bar";
import { WorkspacePanel } from "../ui/workspace-panel";

/**
 * Painéis da toolbar. O mesmo componente roda na casca (web, plano B) ou na camada acima
 * da página (app: dist/overlay.html), com as mesmas props.
 */
export type PanelSpec =
  | { kind: "menu"; key?: string; props: ComponentProps<typeof AppMenu> }
  | { kind: "downloads"; key?: string; props: ComponentProps<typeof DownloadsPanel> }
  | { kind: "privacy"; key?: string; props: ComponentProps<typeof PrivacyPanel> }
  | { kind: "site"; key?: string; props: ComponentProps<typeof SitePanel> }
  | { kind: "key"; key?: string; props: ComponentProps<typeof KeyPanel> }
  | { kind: "autofill"; key?: string; props: ComponentProps<typeof AutofillPopup> }
  /** O mesmo popup, aberto pela chave da barra de endereço (com foco: busca e salvar). */
  | { kind: "login"; key?: string; props: ComponentProps<typeof AutofillPopup> }
  | { kind: "folder"; key?: string; props: ComponentProps<typeof FolderMenu> }
  | { kind: "bookmark"; key?: string; props: ComponentProps<typeof BookmarkEditor> }
  | { kind: "palette"; key?: string; props: ComponentProps<typeof CommandPalette> }
  | { kind: "workspaces"; key?: string; props: ComponentProps<typeof WorkspacePanel> }
  | { kind: "group"; key?: string; props: ComponentProps<typeof GroupEditor> }
  /** Apps da barra lateral que não couberam na altura (3.1.1). */
  | { kind: "sideapps"; key?: string; props: ComponentProps<typeof SideAppsMenu> }
  /** 4.6: extensões (quebra-cabeça da barra). */
  | { kind: "extensions"; key?: string; props: ComponentProps<typeof ExtensionsPanel> }
  /** 4.6: menu de uma extensão (clique direito ou "…"). */
  | { kind: "extmenu"; key?: string; props: ComponentProps<typeof ExtensionMenu> }
  /** 4.6: menu Ferramentas da barra lateral. */
  | { kind: "tools"; key?: string; props: ComponentProps<typeof ToolsMenu> }
  /** 4.7: ColorTools (popover do conta-gotas da barra). */
  | { kind: "colors"; key?: string; props: ComponentProps<typeof ColorToolsPanel> }
  /** Tradução: popup do ícone da barra de URL e bolha do trecho selecionado. */
  | { kind: "translate"; key?: string; props: ComponentProps<typeof TranslatePagePanel> }
  | { kind: "translation"; key?: string; props: ComponentProps<typeof TranslationBubble> }
  /** 5.0: yt-dlp (qualidade do vídeo ou instalação do binário). */
  | { kind: "ytdlp"; key?: string; props: ComponentProps<typeof YtdlpMenu> }
  /** 5.0.3: Recarregar com o DevTools aberto (normal, sem cache, esvaziar o cache). */
  | { kind: "reload"; key?: string; props: ComponentProps<typeof ReloadMenu> }
  | { kind: "cast"; key?: string; props: ComponentProps<typeof CastMenu> };

export type PanelKind = PanelSpec["kind"];

export function PanelView({ spec }: { spec: PanelSpec }) {
  const key = spec.key ?? spec.kind;
  switch (spec.kind) {
    case "menu":
      return <AppMenu key={key} {...spec.props} />;
    case "downloads":
      return <DownloadsPanel key={key} {...spec.props} />;
    case "privacy":
      return <PrivacyPanel key={key} {...spec.props} />;
    case "site":
      return <SitePanel key={key} {...spec.props} />;
    case "key":
      return <KeyPanel key={key} {...spec.props} />;
    case "folder":
      return <FolderMenu key={key} {...spec.props} />;
    case "autofill":
      return <AutofillPopup key={key} {...spec.props} />;
    case "login":
      return <AutofillPopup key={key} {...spec.props} />;
    case "bookmark":
      return <BookmarkEditor key={key} {...spec.props} />;
    case "palette":
      return <CommandPalette key={key} {...spec.props} />;
    case "workspaces":
      return <WorkspacePanel key={key} {...spec.props} />;
    case "group":
      return <GroupEditor key={key} {...spec.props} />;
    case "sideapps":
      return <SideAppsMenu key={key} {...spec.props} />;
    case "extensions":
      return <ExtensionsPanel key={key} {...spec.props} />;
    case "extmenu":
      return <ExtensionMenu key={key} {...spec.props} />;
    case "tools":
      return <ToolsMenu key={key} {...spec.props} />;
    case "colors":
      return <ColorToolsPanel key={key} {...spec.props} />;
    case "translate":
      return <TranslatePagePanel key={key} {...spec.props} />;
    case "translation":
      return <TranslationBubble key={key} {...spec.props} />;
    case "ytdlp":
      return <YtdlpMenu key={key} {...spec.props} />;
    case "reload":
      return <ReloadMenu key={key} {...spec.props} />;
    case "cast":
      return <CastMenu key={key} {...spec.props} />;
  }
}
