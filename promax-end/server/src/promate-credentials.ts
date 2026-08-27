export interface PromateCredentialProvider {
  tokenFor(employeeId: string): string | undefined
}

export class StaticPromateCredentialProvider implements PromateCredentialProvider {
  constructor(private readonly tokens: Readonly<Record<string, string>>) {}

  tokenFor(employeeId: string): string | undefined {
    return Object.hasOwn(this.tokens, employeeId) ? this.tokens[employeeId] : undefined
  }
}
