import { isResearchRequest } from '../../../shared/conversation-intent.mjs';

export function isResearchConversation(text: string, previousAssistant = '') {
  return isResearchRequest(text)
    || /Research clarification ID: [a-f0-9-]{36}/.test(previousAssistant);
}

export function looksLikeCrmSpecification(text: string) {
  // Length and generic engineering vocabulary are not evidence of CRM intent.
  return /\b(?:crm|customer relationship management)\b/i.test(text)
    && text.trim().split(/\s+/).length >= 10;
}

export function selectConversationRoute({ text, previousAssistant = '', crmFactoryActive, crmStart, crmBuild, hasPreviousCrmSpec }: {
  text: string; previousAssistant?: string; crmFactoryActive: boolean; crmStart: boolean; crmBuild: boolean; hasPreviousCrmSpec: boolean;
}) {
  const research = isResearchConversation(text, previousAssistant);
  const buildCrm = !research && crmBuild && hasPreviousCrmSpec;
  // In an active intake, require CRM-domain details instead of accepting every turn.
  const crmIntake = crmFactoryActive && /\b(?:leads?|contacts?|customers?|sales pipeline|crm|customer relationship management)\b/i.test(text);
  const captureCrm = !research && !crmStart && !crmBuild && (looksLikeCrmSpecification(text) || crmIntake);
  return { research, buildCrm, captureCrm };
}
