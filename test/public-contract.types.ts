import { tools, type Action, type ActionArgs, type Tools, type Runtime } from '~/index'

const optionalVariables: Omit<Runtime, 'variables'> extends Runtime ? true : false = true
const requiredTools: Omit<ActionArgs<{}>, 'tools'> extends ActionArgs<{}> ? true : false = false
const toolkit: Tools = tools
const action: Action<{}> = ({ tools }) => {
  const mapped: Record<string, number> = tools.map({ first: { count: 1 } }, (_key, { count }) => count, {
    shallow: true,
  })
  const cloned: { count: number } = tools.clone({ count: 1 })
  const parsed: unknown = tools.parse('{"count":1}')
  const encoded: string | undefined = tools.stringify(cloned)
  // @ts-expect-error stringify retains its native undefined result possibility.
  const requiredText: string = tools.stringify(undefined)
  // @ts-expect-error parse does not prove a domain type.
  const parsedObject: { count: number } = tools.parse('{"count":1}')

  tools.each(
    { first: { count: 1 } },
    (key, { count }) => {
      const name: string = key
      const value: number = count
      // @ts-expect-error Shallow dictionaries provide string keys.
      const index: number = key

      void name
      void value
      void index
    },
    { shallow: true }
  )
  tools.each(
    [{ count: 1 }],
    (key, { count }) => {
      const index: number = key
      const value: number = count

      void index
      void value
    },
    { shallow: true }
  )
  // @ts-expect-error Shared toolkit methods are readonly.
  tools.map = tools.map
  void mapped
  void parsed
  void encoded
  void requiredText
  void parsedObject
}
const manualCall = (args: Omit<ActionArgs<{}>, 'tools'>) => action({ ...args, tools })

void optionalVariables
void requiredTools
void toolkit
void manualCall
