import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import App from "../src/App";
import { StoreProvider } from "../src/state/store";
import { BUILT_IN_VOCABULARY } from "../src/data";

/**
 * End-to-end smoke test of the UI: boot -> dashboard -> a real quiz question
 * answered -> feedback -> session summary, plus the vocabulary browser search.
 * Storage is fake-indexeddb (loaded in vitest.setup.ts), so this exercises the
 * real persistence path rather than a mock.
 */

function tabs(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll("nav.tabs button"));
}

async function boot() {
  const view = render(
    <StoreProvider>
      <App />
    </StoreProvider>
  );
  await screen.findByText(/きょうの状況/);
  return view;
}

describe("app shell", () => {
  it("answers a generated question and reaches the summary", async () => {
    const { container } = await boot();

    // The dashboard reports the built-in dataset size.
    expect(screen.getByText(new RegExp(`${BUILT_IN_VOCABULARY.length} terms`))).toBeInTheDocument();

    fireEvent.click(tabs(container)[1]); // 学習 / Study
    await screen.findByText(/セッション設定/);

    fireEvent.click(screen.getByRole("button", { name: /はじめる \/ Start/ }));

    const card = await waitFor(() => {
      const found = container.querySelector(".qcard");
      if (!found) throw new Error("no question card rendered");
      return found as HTMLElement;
    });
    const choices = Array.from(card.querySelectorAll(".choice"));
    expect(choices).toHaveLength(4);

    fireEvent.click(choices[0]);

    await screen.findByText(/正しい \/ Correct|ちがいます \/ Not quite/);
    const progress = container.querySelector(".study-progress");
    expect(progress?.textContent).toContain("1 answered");

    fireEvent.click(screen.getByRole("button", { name: /結果を見る|次へ/ }));
    // More questions follow; end the session to see the summary.
    const end = await screen.findByRole("button", { name: /end session/ });
    fireEvent.click(end);
    await screen.findByText(/セッション完了/);
  });

  it("grades a correct answer as 難しい and carries that grade into the summary", async () => {
    const { container } = await boot();

    fireEvent.click(tabs(container)[1]); // 学習 / Study
    await screen.findByText(/セッション設定/);
    // Which option is correct is random and the self-assessment step only appears
    // after a correct answer, so ask for the longest session to get enough attempts.
    fireEvent.change(screen.getByLabelText(/Session size/), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: /はじめる \/ Start/ }));

    let graded = false;
    for (let attempt = 0; attempt < 30 && !graded; attempt += 1) {
      const card = await waitFor(() => {
        const found = container.querySelector(".qcard");
        if (!found) throw new Error("no question card rendered");
        return found as HTMLElement;
      });
      const choices = Array.from(card.querySelectorAll(".choice"));
      fireEvent.click(choices[0]);
      await screen.findByText(/正しい \/ Correct|ちがいます \/ Not quite/);

      const gradeButton = screen.queryByRole("button", { name: /難しい/ });
      if (gradeButton) {
        // Self-grading is on by default: the schedule needs to know how hard it felt.
        fireEvent.click(gradeButton);
        await screen.findByText(/graded as 難しい/);
        graded = true;
        break;
      }
      // A missed answer goes straight back as もう一度 with nothing to rate, so
      // take another question instead.
      fireEvent.click(screen.getByRole("button", { name: /結果を見る|次へ/ }));
    }
    expect(graded).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /結果を見る|次へ/ }));
    fireEvent.click(await screen.findByRole("button", { name: /end session/ }));
    await screen.findByText(/セッション完了/);

    const gradeStat = Array.from(container.querySelectorAll(".stat"))
      .map((node) => ({
        label: node.querySelector(".stat-label")?.textContent ?? "",
        value: node.querySelector(".stat-value")?.textContent ?? "",
      }))
      .find((stat) => stat.label === "難しい / hard");
    expect(gradeStat?.value).toBe("1");
    // This case may take several questions before one is answered correctly, so it
    // needs more than the default 5s timeout.
  }, 30_000);

  it("searches the vocabulary browser and opens an entry", async () => {
    const { container } = await boot();

    fireEvent.click(tabs(container)[2]); // 用語一覧 / Vocabulary
    await screen.findByText(/用語一覧 \/ Vocabulary/);

    const search = screen.getByPlaceholderText(/告知 \/ disclosure/) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "告知義務" } });

    const link = await screen.findByText("告知義務");
    fireEvent.click(link);

    await screen.findByText(/Meaning & usage/);
    expect(screen.getByText(/例文 \/ example/)).toBeInTheDocument();
  });

  it("opens a kyosai entry with its source and the insurance word it maps to", async () => {
    const { container } = await boot();

    fireEvent.click(tabs(container)[2]); // 用語一覧 / Vocabulary
    await screen.findByText(/用語一覧 \/ Vocabulary/);

    const search = screen.getByPlaceholderText(/告知 \/ disclosure/) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "共済掛金" } });

    fireEvent.click(await screen.findByText("共済掛金"));
    await screen.findByText(/Meaning & usage/);

    // The entry is attributed to the JA共済用語集 page it was read from...
    expect(screen.getByText("https://www.ja-kyosai.or.jp/words/ka/1850.html")).toBeInTheDocument();
    // ...and it teaches the insurance word the kyosai word corresponds to.
    expect(screen.getAllByText("保険料").length).toBeGreaterThan(0);
  });

  it("creates and deletes a personal term through the editor", async () => {
    const { container } = await boot();
    const term = "簡易審査テスト";

    fireEvent.click(tabs(container)[2]);
    fireEvent.click(screen.getByRole("button", { name: /add your own term/ }));

    fireEvent.change(screen.getByLabelText(/用語 \/ Term/), { target: { value: term } });
    fireEvent.change(screen.getByLabelText(/Translation \*/), { target: { value: "abbreviated screening test" } });
    fireEvent.change(screen.getByLabelText(/definitionJa/), {
      target: { value: "簡易な審査によって引受可否を判断すること。" },
    });
    fireEvent.change(screen.getByLabelText(/explanationEn/), {
      target: { value: "a light-touch screening used to decide whether to accept a risk." },
    });
    fireEvent.change(screen.getByLabelText(/context/), {
      target: { value: "新規契約の一次スクリーニング画面で使われる表記。" },
    });
    fireEvent.change(screen.getByPlaceholderText(/簡易審査で引き受け可否/), {
      target: { value: `${term}では、健康状態の申告のみで引受可否を判断する。` },
    });
    fireEvent.change(screen.getByPlaceholderText(/かんいしんさで/), {
      target: { value: "かんいしんさテストでは、けんこうじょうたいのしんこくのみでひきうけかひをはんだんする。" },
    });
    fireEvent.change(screen.getByPlaceholderText(/kangi shinsa de/), {
      target: { value: "kangi shinsa tesuto de wa, hikiuke kahi o handan suru." },
    });
    fireEvent.change(screen.getByPlaceholderText(/We decide whether/), {
      target: { value: "Acceptance is decided from the health declaration alone." },
    });

    fireEvent.click(screen.getByRole("button", { name: /保存 \/ Save/ }));

    // The editor closes and the new entry opens in the detail view.
    await screen.findByText(/Meaning & usage/);
    expect(await screen.findAllByText(term)).not.toHaveLength(0);
    expect(screen.getByText("your entry")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    await waitFor(() => expect(screen.queryByText(term)).not.toBeInTheDocument());
    // This case drives the full 143-row list plus the editor form end to end, so it is
    // given more than the default 5s timeout.
  }, 20_000);

  it("shows settings and the backup preview", async () => {
    const { container } = await boot();

    fireEvent.click(tabs(container)[4]); // データ・設定 / Data & settings
    await screen.findByText(/バックアップ/);

    fireEvent.click(screen.getByRole("button", { name: /エクスポート \/ export JSON/ }));
    await screen.findByText(/backup ready/);

    const area = container.querySelector("textarea.mono") as HTMLTextAreaElement;
    expect(area.value).toContain('"app": "japanese-insurance-terminology-trainer"');

    fireEvent.click(screen.getByRole("button", { name: /preview import/ }));
    await screen.findByText(/preview \(merge\)/);
  });
});
