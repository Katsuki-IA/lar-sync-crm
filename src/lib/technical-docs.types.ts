export type TechnicalSection = {
  id: string;
  title: string;
  summary: string;
  entries: { title: string; text: string; source?: string; href?: string }[];
};
export type TechnicalMap = {
  title: string;
  description: string;
  steps: { title: string; text: string }[];
};
export type TechnicalDocs = {
  reviewedAt: string;
  scope: string;
  maps: TechnicalMap[];
  sections: TechnicalSection[];
};
