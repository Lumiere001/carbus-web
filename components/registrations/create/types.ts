import type { CreateRegistrationInput } from "@/lib/registrations/create-schema";

export type CreateFieldsProps = {
  readonly value: CreateRegistrationInput;
  readonly onChange: (patch: Partial<CreateRegistrationInput>) => void;
};
export const createInputClass = "w-full min-h-11 min-w-0 rounded-md border border-border-2 bg-surface px-3 py-2 text-base text-foreground sm:text-sm";
export const createLabelClass = "block min-w-0 space-y-1 text-sm text-muted";
export const createSectionClass = "min-w-0 rounded-lg border border-border p-4 space-y-4";
