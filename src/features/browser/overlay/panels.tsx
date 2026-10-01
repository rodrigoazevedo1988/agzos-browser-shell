import type { ComponentProps } from "react";

import { BookmarkEditor } from "@/features/bookmarks/editor";
import { DownloadsPanel } from "@/features/downloads/panel";
import { AutofillPopup } from "@/features/key/autofill-popup";
import { KeyPanel } from "@/features/key/panel";
import { PrivacyPanel } from "@/features/privacy/panel";
import { AppMenu } from "@/features/settings/menu";
import { SitePanel } from "@/features/site/panel";

import { CommandPalette } from "../ui/command-palette";
import { FolderMenu } from "../ui/folder-dropdown";
import { GroupEditor } from "../ui/group-editor";
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
  | { kind: "folder"; key?: string; props: ComponentProps<typeof FolderMenu> }
  | { kind: "bookmark"; key?: string; props: ComponentProps<typeof BookmarkEditor> }
  | { kind: "palette"; key?: string; props: ComponentProps<typeof CommandPalette> }
  | { kind: "workspaces"; key?: string; props: ComponentProps<typeof WorkspacePanel> }
  | { kind: "group"; key?: string; props: ComponentProps<typeof GroupEditor> };

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
    case "bookmark":
      return <BookmarkEditor key={key} {...spec.props} />;
    case "palette":
      return <CommandPalette key={key} {...spec.props} />;
    case "workspaces":
      return <WorkspacePanel key={key} {...spec.props} />;
    case "group":
      return <GroupEditor key={key} {...spec.props} />;
  }
}
