import {Component,type ErrorInfo,type ReactNode} from 'react'

export class WorkspaceLoadBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false}
  static getDerivedStateFromError(){return {failed:true}}
  componentDidCatch(_error:Error,_info:ErrorInfo){
    // Do not log session data or component props. A failed chunk must not create
    // an automatic reload loop or silently discard the user's current work.
  }
  render(){
    if(this.state.failed)return <main className="content" role="alert"><h1>Não foi possível abrir esta área</h1><p>Verifique a conexão. Recarregar a página pode descartar informações que ainda não foram enviadas.</p><button type="button" onClick={()=>window.location.reload()}>Recarregar página</button></main>
    return this.props.children
  }
}
