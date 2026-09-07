import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ExecutionErrorBoundaryProps {
  children: ReactNode
  onBack: () => void
  onRetry: () => Promise<void>
}

interface ExecutionErrorBoundaryState {
  error: Error | null
  retrying: boolean
}

export class ExecutionErrorBoundary extends Component<
  ExecutionErrorBoundaryProps,
  ExecutionErrorBoundaryState
> {
  state: ExecutionErrorBoundaryState = {
    error: null,
    retrying: false,
  }

  static getDerivedStateFromError(error: Error): Partial<ExecutionErrorBoundaryState> {
    return { error, retrying: false }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Falha ao renderizar a execução do checklist.', error, info)
  }

  private retry = async (): Promise<void> => {
    this.setState({ retrying: true })
    try {
      await this.props.onRetry()
      this.setState({ error: null, retrying: false })
    } catch {
      this.setState({ retrying: false })
    }
  }

  private back = (): void => {
    this.setState({ error: null, retrying: false }, this.props.onBack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <section className="screen">
        <article className="state-panel state-panel--error" role="alert">
          <span className="state-panel__kicker">Execução temporariamente indisponível</span>
          <h1>Não foi possível exibir o checklist</h1>
          <p>
            Os dados da execução continuam salvos. Atualize as informações ou volte
            para a análise técnica.
          </p>
          <div className="detail-error-actions">
            <button type="button" className="secondary-button" onClick={this.back}>
              Voltar
            </button>
            <button
              type="button"
              disabled={this.state.retrying}
              onClick={() => void this.retry()}
            >
              {this.state.retrying ? 'Atualizando…' : 'Atualizar checklist'}
            </button>
          </div>
        </article>
      </section>
    )
  }
}
