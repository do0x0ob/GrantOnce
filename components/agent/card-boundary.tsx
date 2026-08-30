"use client";

import { Component, type ReactNode } from "react";

/**
 * One boundary per card.
 *
 * Card payloads are assembled from tool output, and eventually some of that
 * output will be model-authored and the wrong shape. Without a boundary a
 * single bad field blanks the whole thread and the user loses what they typed;
 * with one, only that card degrades. React still has no hook form of this, so
 * it stays a class.
 */
export class CardBoundary extends Component<
  { children: ReactNode; label?: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[grantonce] card failed to render", error);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="rounded-[28px] bg-[var(--wash-risk)] px-6 py-5 text-[13px] leading-6 text-stone-600">
          這張卡片顯示失敗{this.props.label ? `（${this.props.label}）` : ""}。其餘內容不受影響。
        </div>
      );
    }
    return this.props.children;
  }
}
