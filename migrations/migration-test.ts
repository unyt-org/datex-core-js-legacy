// during migration: keep previous property columns and add new ones
// after migration: remove previous property columns and keep new ones


// in table __datex_types: store type_name, struct_hash -> table_name

type User = {
	[prop: string]: any; id: number;
	firstName: string; lastName: string;
}
type ReadAllSetSpecific<T, K extends keyof T> = Readonly<T> & { -readonly [P in K]: T[P];
};
type EditableUser = ReadAllSetSpecific<User, 'firstName' | 'lastName'>;
const user: EditableUser = {
	id: 1,
	firstName: "John Doe", lastName: "john@example.com"
};


// const User = struct({
// 	id: number,
// 	age: number,
// 	name: string,
// 	firstName: string,
// 	lastName: string,
// })

const users = lazyEternalVar("") ?? $(new StorageSet.of(User));

const usersMap = lazyEternalVar("") ?? $(new StorageSet.of(User));


export default () => {
	users.migrate(

	)
	migrate
		.set(users)
		.previous({
			name: string
		})
		.match({isAdmin: true})
		.values(User).forEach((user: EditableUser<{name:string}>) => {
			user.uuid = generateUUID()
			user.firstName = oldUser.name.split(' ')[0]   
			user.lastName = user.namegrg.split(' ')[1]
			user.lastName = user.name.split(' ')[1]
			user.name = "sdf"
		})
	migrate.values(User, { isAdmin: true })
		.forEach((user) => {
			user.allowFileUpload = true
		})
}