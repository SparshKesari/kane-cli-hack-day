"use server";
import { formObject } from "@/server/core";
import { saveWorkflowTask } from "@/server/workflow";
import { act } from "../_kit/act";
import type { OpsState } from "../_kit/state";

export async function saveWorkflowAction(_previous: OpsState, form: FormData): Promise<OpsState> {
  return act(["organizer"], form, async staff => ({ message: "Owner and task status saved for the event team.", receipt: await saveWorkflowTask(formObject(form), staff) }));
}
