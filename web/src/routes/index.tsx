import { createFileRoute } from '@tanstack/react-router'
import { HomePage } from '../HomePage'

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): { home?: string } =>
    typeof search.home === 'string' && search.home ? { home: search.home } : {},
  component: HomePage,
})
