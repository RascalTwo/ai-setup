import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { App } from "./App.tsx";

afterEach(cleanup);

test("adding a mug shows its total", () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Add mug" }));
  expect(screen.getByText("Total: 13.2")).toBeTruthy();
});
