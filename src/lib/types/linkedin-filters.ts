export interface DBFilters {
  role?: string;
  company?: string;
  location?: string;
  university?: string;
  minYearsExperience?: number;
  roleSpecificity?: 'narrow' | 'standard' | 'broad';
}

export interface LinkedInFilters {
  searchQuery?: string;
  locations?: string[];
  currentCompanies?: string[];        // LinkedIn company URLs
  pastCompanies?: string[];
  schools?: string[];
  currentJobTitles?: string[];
  pastJobTitles?: string[];
  seniorityLevelIds?: string[];
  functionIds?: string[];
  industryIds?: string[];             // Curated subset — see VALID_INDUSTRY_IDS
  companyHeadcount?: string[];
  yearsOfExperienceIds?: string[];
  yearsAtCurrentCompanyIds?: string[];
  recentlyChangedJobs?: boolean;
  // Exclude filters
  excludeLocations?: string[];
  excludeCurrentCompanies?: string[];
  excludeSeniorityLevelIds?: string[];
  excludeFunctionIds?: string[];
}
