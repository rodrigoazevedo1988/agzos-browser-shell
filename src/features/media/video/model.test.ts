import { describe, expect, it } from "vitest";

import { parseMedia } from "@/features/browser/persistence/snapshot";
import {
  VIDEOS_URL,
  breadcrumbOf,
  continueItems,
  fileOfVideosUrl,
  formatTime,
  isInProgress,
  isVideosUrl,
  mediaErrorMessage,
  matchesSearch,
  nameOf,
  nextIndex,
  parentOf,
  resumeAt,
  srtToVtt,
  titleOf,
  toggleIn,
  videosUrlOf,
  withRecent,
} from "./model";

const rec = (path: string, position: number, duration: number, at = 1) => ({
  path,
  kind: "video" as const,
  position,
  duration,
  at,
});

describe("formatTime", () => {
  it("formats minutes and hours, and tolerates bad input", () => {
    expect(formatTime(83)).toBe("1:23");
    expect(formatTime(3723)).toBe("1:02:03");
    expect(formatTime(5)).toBe("0:05");
    expect(formatTime(Number.NaN)).toBe("0:00");
    expect(formatTime(-4)).toBe("0:00");
  });
});

describe("breadcrumbOf", () => {
  it("splits POSIX paths", () => {
    expect(breadcrumbOf("/home/ana/Filmes")).toEqual([
      { label: "/", path: "/" },
      { label: "home", path: "/home" },
      { label: "ana", path: "/home/ana" },
      { label: "Filmes", path: "/home/ana/Filmes" },
    ]);
  });
  it("splits Windows paths keeping the drive root", () => {
    expect(breadcrumbOf("D:\\Séries\\2024")).toEqual([
      { label: "D:\\", path: "D:\\" },
      { label: "Séries", path: "D:\\Séries" },
      { label: "2024", path: "D:\\Séries\\2024" },
    ]);
  });
  it("returns an empty list for an empty folder", () => {
    expect(breadcrumbOf("")).toEqual([]);
  });
});

describe("search and names", () => {
  it("ignores accents and case", () => {
    expect(matchesSearch("Ação Final.mp4", "acao")).toBe(true);
    expect(matchesSearch("Ação Final.mp4", "FINAL")).toBe(true);
    expect(matchesSearch("Ação Final.mp4", "comédia")).toBe(false);
    expect(matchesSearch("qualquer", "  ")).toBe(true);
  });
  it("gets names, parents and titles from both separators", () => {
    expect(nameOf("/a/b/Aula 01.mp4")).toBe("Aula 01.mp4");
    expect(nameOf("C:\\x\\Filme.mkv")).toBe("Filme.mkv");
    expect(parentOf("/a/b/c.mp4")).toBe("/a/b");
    expect(parentOf("C:\\x\\c.mp4")).toBe("C:\\x");
    expect(parentOf("/c.mp4")).toBe("/");
    expect(titleOf("Aula 01.mp4")).toBe("Aula 01");
    expect(titleOf(".hidden")).toBe(".hidden");
  });
});

describe("resume and continue", () => {
  it("resumes only after 5s and before 95% of the duration", () => {
    expect(isInProgress(rec("a", 4, 100, 1))).toBe(false);
    expect(isInProgress(rec("a", 50, 100, 1))).toBe(true);
    expect(isInProgress(rec("a", 96, 100, 1))).toBe(false);
    expect(isInProgress(rec("a", 60, 0, 1))).toBe(true);
  });
  it("lists in-progress videos, newest first", () => {
    const list = continueItems([
      rec("old", 30, 100, 1),
      rec("done", 99, 100, 5),
      rec("new", 10, 100, 9),
      { ...rec("audio", 10, 100, 9), kind: "audio" as const },
    ]);
    expect(list.map((item) => item.path)).toEqual(["new", "old"]);
  });
  it("resumeAt returns 0 for finished or unknown files", () => {
    const recent = [rec("a", 42, 100), rec("b", 99, 100)];
    expect(resumeAt(recent, "a")).toBe(42);
    expect(resumeAt(recent, "b")).toBe(0);
    expect(resumeAt(recent, "zzz")).toBe(0);
  });
  it("withRecent puts the file on top once and keeps the limit", () => {
    const next = withRecent([rec("a", 1, 10, 1), rec("b", 2, 10, 2)], rec("a", 7, 10, 3));
    expect(next.map((item) => item.path)).toEqual(["a", "b"]);
    expect(next[0]?.position).toBe(7);
  });
  it("toggleIn adds, removes and limits", () => {
    expect(toggleIn([], "/x.mp4", 2)).toEqual(["/x.mp4"]);
    expect(toggleIn(["/x.mp4"], "/x.mp4", 2)).toEqual([]);
    expect(toggleIn(["/a", "/b"], "/c", 2)).toEqual(["/c", "/a"]);
  });
});

describe("nextIndex", () => {
  it("returns the next file of the folder, or null at the end", () => {
    const paths = ["/e1.mp4", "/e2.mp4", "/e3.mp4"];
    expect(nextIndex(paths, "/e1.mp4")).toBe(1);
    expect(nextIndex(paths, "/e3.mp4")).toBeNull();
    expect(nextIndex(paths, "/nope.mp4")).toBeNull();
  });
});

describe("srtToVtt", () => {
  it("adds the WEBVTT header and turns comma milliseconds into dots", () => {
    const srt =
      "1\r\n00:00:01,500 --> 00:00:03,250\r\nOlá\r\n\r\n2\r\n00:01:02,5 --> 00:01:04,000\r\nTchau\r\n";
    const vtt = srtToVtt(srt);
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain("00:00:01.500 --> 00:00:03.250");
    expect(vtt).toContain("00:01:02.500 --> 00:01:04.000");
    expect(vtt).toContain("Olá");
    expect(vtt).not.toContain("\r");
  });
  it("keeps an existing VTT header and strips a BOM", () => {
    expect(srtToVtt("\uFEFFWEBVTT\n\n00:00:01.000 --> 00:00:02.000\nOi\n")).toBe(
      "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nOi\n",
    );
  });
  it("does not touch commas outside timing lines", () => {
    expect(srtToVtt("1\n00:00:01,000 --> 00:00:02,000\nSim, claro, 10,000 vezes")).toContain(
      "Sim, claro, 10,000 vezes",
    );
  });
});

describe("error messages and urls", () => {
  it("explains unsupported formats", () => {
    expect(mediaErrorMessage(4)).toMatch(/AVI/);
    expect(mediaErrorMessage(3)).toMatch(/decodificar/);
    expect(mediaErrorMessage(undefined)).toMatch(/Não foi possível/);
  });
  it("builds and reads agzos://videos?file=", () => {
    expect(videosUrlOf(null)).toBe(VIDEOS_URL);
    const url = videosUrlOf("/home/ana/Aula 1.mp4");
    expect(url).toBe("agzos://videos?file=%2Fhome%2Fana%2FAula%201.mp4");
    expect(isVideosUrl(url)).toBe(true);
    expect(fileOfVideosUrl(url)).toBe("/home/ana/Aula 1.mp4");
    expect(fileOfVideosUrl(VIDEOS_URL)).toBeNull();
    expect(isVideosUrl("agzos://videosx")).toBe(false);
  });
});

describe("parseMedia (section media)", () => {
  it("keeps valid entries and drops the rest", () => {
    const lib = parseMedia({
      recent: [
        rec("/a.mp4", 10, 100, 2),
        { path: "relativo.mp4", kind: "video", position: 1, duration: 1, at: 1 },
        { path: "/b.mp4", kind: "movie", position: 1, duration: 1, at: 1 },
        { path: "/a.mp4", kind: "video", position: 5, duration: 100, at: 9 },
      ],
      favorites: ["/a.mp4", "/a.mp4", 7, "C:\\x\\y.mkv"],
      folders: ["/home/ana", "nope"],
    });
    expect(lib.recent.map((item) => item.path)).toEqual(["/a.mp4"]);
    expect(lib.favorites).toEqual(["/a.mp4", "C:\\x\\y.mkv"]);
    expect(lib.folders).toEqual(["/home/ana"]);
  });
  it("returns an empty library for garbage", () => {
    for (const value of [null, "x"]) {
      const lib = parseMedia(value);
      expect(lib.recent).toEqual([]);
      expect(lib.favorites).toEqual([]);
      expect(lib.folders).toEqual([]);
    }
  });
});
